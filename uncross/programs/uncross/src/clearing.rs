use crate::state::{OrderSummary, MAX_ORDERS, SIDE_BUY, SIDE_SELL};

/// Sum of buy quantities with limit_price >= p.
fn demand_at(orders: &[OrderSummary], p: u64) -> u64 {
    orders
        .iter()
        .filter(|o| o.is_live() && o.side == SIDE_BUY && o.limit_price >= p)
        .fold(0u64, |acc, o| acc.saturating_add(o.quantity))
}

/// Sum of sell quantities with limit_price <= p.
fn supply_at(orders: &[OrderSummary], p: u64) -> u64 {
    orders
        .iter()
        .filter(|o| o.is_live() && o.side == SIDE_SELL && o.limit_price <= p)
        .fold(0u64, |acc, o| acc.saturating_add(o.quantity))
}

fn candidate_prices(orders: &[OrderSummary]) -> Vec<u64> {
    let mut prices: Vec<u64> = orders.iter().filter(|o| o.is_live()).map(|o| o.limit_price).collect();
    prices.sort_unstable();
    prices.dedup();
    prices
}

/// Uniform-price double-auction clearing price: argmax over candidate prices of
/// V(p) = min(Demand(p), Supply(p)), tie-broken by (1) minimal
/// |Demand(p) - Supply(p)|, then (2) nearest to a fresh oracle price if one is
/// supplied, then (3) the midpoint of the still-tied range.
///
/// Executable volume is recomputed at the *final* p_star because tie-break (3)
/// can land strictly between two real order prices.
///
/// (0, 0) if no orders exist or no candidate price clears any volume.
pub fn find_clearing_price(orders: &[OrderSummary], oracle_price: Option<u64>) -> (u64, u64) {
    let candidates = candidate_prices(orders);
    if candidates.is_empty() {
        return (0, 0);
    }

    let mut best_v = 0u64;
    let mut best: Vec<u64> = Vec::new();
    for &p in &candidates {
        let v = demand_at(orders, p).min(supply_at(orders, p));
        match v.cmp(&best_v) {
            std::cmp::Ordering::Greater => {
                best_v = v;
                best = vec![p];
            }
            std::cmp::Ordering::Equal if v > 0 => best.push(p),
            _ => {}
        }
    }

    if best.is_empty() {
        return (candidates[0], 0);
    }

    let p_star = if best.len() == 1 {
        best[0]
    } else {
        let mut min_gap = u64::MAX;
        let mut gap_ties: Vec<u64> = Vec::new();
        for &p in &best {
            let gap = demand_at(orders, p).abs_diff(supply_at(orders, p));
            match gap.cmp(&min_gap) {
                std::cmp::Ordering::Less => {
                    min_gap = gap;
                    gap_ties = vec![p];
                }
                std::cmp::Ordering::Equal => gap_ties.push(p),
                _ => {}
            }
        }
        if gap_ties.len() == 1 {
            gap_ties[0]
        } else if let Some(oracle_p) = oracle_price {
            *gap_ties
                .iter()
                .min_by_key(|&&p| (p as i128 - oracle_p as i128).abs())
                .unwrap()
        } else {
            let lo = *gap_ties.iter().min().unwrap();
            let hi = *gap_ties.iter().max().unwrap();
            lo + (hi - lo) / 2
        }
    };

    let v_star = demand_at(orders, p_star).min(supply_at(orders, p_star));
    (p_star, v_star)
}

/// Writes filled_quantity for every live order. Within each side, orders fill
/// in strict price priority (best price first) up to v_star; the single marginal
/// tier where the cutoff falls is pro-rated. Does not assume p_star is one of
/// the book's own limit prices.
pub fn assign_fills(orders: &mut [OrderSummary; MAX_ORDERS], p_star: u64, v_star: u64) {
    for o in orders.iter_mut() {
        if o.active != 0 {
            o.filled_quantity = 0;
        }
    }
    if v_star == 0 {
        return;
    }
    fill_side(orders, SIDE_BUY, p_star, v_star);
    fill_side(orders, SIDE_SELL, p_star, v_star);
}

fn fill_side(orders: &mut [OrderSummary; MAX_ORDERS], side: u8, p_star: u64, v_star: u64) {
    let mut idxs: Vec<usize> = (0..orders.len())
        .filter(|&i| {
            let o = &orders[i];
            o.is_live()
                && o.side == side
                && if side == SIDE_BUY { o.limit_price >= p_star } else { o.limit_price <= p_star }
        })
        .collect();

    // Best price first: highest for buys, lowest for sells.
    if side == SIDE_BUY {
        idxs.sort_by(|&a, &b| orders[b].limit_price.cmp(&orders[a].limit_price));
    } else {
        idxs.sort_by(|&a, &b| orders[a].limit_price.cmp(&orders[b].limit_price));
    }

    let mut remaining = v_star;
    let mut i = 0;
    while i < idxs.len() && remaining > 0 {
        let tier_price = orders[idxs[i]].limit_price;
        let mut j = i;
        let mut tier_total: u64 = 0;
        while j < idxs.len() && orders[idxs[j]].limit_price == tier_price {
            tier_total = tier_total.saturating_add(orders[idxs[j]].quantity);
            j += 1;
        }

        if tier_total <= remaining {
            for &k in &idxs[i..j] {
                orders[k].filled_quantity = orders[k].quantity;
            }
            remaining -= tier_total;
        } else {
            let mut assigned: u64 = 0;
            for &k in &idxs[i..j] {
                let fill = (orders[k].quantity as u128 * remaining as u128 / tier_total as u128) as u64;
                orders[k].filled_quantity = fill;
                assigned += fill;
            }
            // Floor division loses <1 unit per order; hand those units back one
            // each, lowest order index first, so this side fills to exactly
            // v_star. Without it the two sides can fill to different totals and
            // settlement pays out more than it collected.
            let mut leftover = remaining - assigned;
            let mut by_index: Vec<usize> = idxs[i..j].to_vec();
            by_index.sort_unstable();
            for k in by_index {
                if leftover == 0 {
                    break;
                }
                if orders[k].filled_quantity < orders[k].quantity {
                    orders[k].filled_quantity += 1;
                    leftover -= 1;
                }
            }
            remaining = 0;
        }
        i = j;
    }
}

/// Quote a buy order must escrow: quantity x limit_price, rounded *up*. Rounding
/// up is what guarantees the quote vault can always cover sellers -- with floor,
/// two buyers each owing 0.5 units escrow 0 between them against a seller owed 1.
pub fn escrow_for_buy(quantity: u64, limit_price: u64, ticker_decimals: u8) -> u64 {
    let d = 10u128.pow(ticker_decimals as u32);
    ((quantity as u128 * limit_price as u128 + d - 1) / d) as u64
}

/// Decides every order's quote leg at clearing time so settlement only moves
/// numbers that already balance. Sellers receive floor(fill x p*). Buyers are
/// charged exactly that total between them, split in proportion to fill and
/// capped at each buyer's escrow. Total charged == total paid out, so both
/// vaults reach exactly zero regardless of settlement batch order.
pub fn assign_quote_amounts(
    orders: &mut [OrderSummary; MAX_ORDERS],
    p_star: u64,
    v_star: u64,
    ticker_decimals: u8,
) {
    for o in orders.iter_mut() {
        if o.active != 0 {
            o.quote_amount = 0;
        }
    }
    if v_star == 0 {
        return;
    }
    let d = 10u128.pow(ticker_decimals as u32);

    let mut total: u128 = 0;
    for o in orders.iter_mut() {
        if o.is_live() && o.side == SIDE_SELL && o.filled_quantity > 0 {
            let pay = o.filled_quantity as u128 * p_star as u128 / d;
            o.quote_amount = pay as u64;
            total += pay;
        }
    }

    let buyers: Vec<usize> = (0..MAX_ORDERS)
        .filter(|&i| orders[i].is_live() && orders[i].side == SIDE_BUY && orders[i].filled_quantity > 0)
        .collect();
    let mut assigned: u128 = 0;
    for &i in &buyers {
        let c = orders[i].filled_quantity as u128 * total / v_star as u128;
        orders[i].quote_amount = c as u64;
        assigned += c;
    }
    let mut leftover = total - assigned;
    while leftover > 0 {
        let mut progressed = false;
        for &i in &buyers {
            if leftover == 0 {
                break;
            }
            let cap = escrow_for_buy(orders[i].quantity, orders[i].limit_price, ticker_decimals);
            if orders[i].quote_amount < cap {
                orders[i].quote_amount += 1;
                leftover -= 1;
                progressed = true;
            }
        }
        if !progressed {
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn order(side: u8, limit_price: u64, quantity: u64) -> OrderSummary {
        OrderSummary { limit_price, quantity, active: 1, side, ..Default::default() }
    }

    fn book(orders: Vec<OrderSummary>) -> [OrderSummary; MAX_ORDERS] {
        let mut arr = [OrderSummary::default(); MAX_ORDERS];
        for (i, o) in orders.into_iter().enumerate() {
            arr[i] = o;
        }
        arr
    }

    fn clear(v: Vec<OrderSummary>, decimals: u8) -> ([OrderSummary; MAX_ORDERS], u64, u64) {
        let (p, vol) = find_clearing_price(&v, None);
        let mut arr = book(v);
        assign_fills(&mut arr, p, vol);
        assign_quote_amounts(&mut arr, p, vol, decimals);
        (arr, p, vol)
    }

    fn side_sum(arr: &[OrderSummary; MAX_ORDERS], side: u8, f: fn(&OrderSummary) -> u64) -> u64 {
        arr.iter().filter(|o| o.active != 0 && o.side == side).map(f).sum()
    }

    fn check_balanced(arr: &[OrderSummary; MAX_ORDERS], decimals: u8) {
        assert_eq!(side_sum(arr, SIDE_BUY, |o| o.filled_quantity), side_sum(arr, SIDE_SELL, |o| o.filled_quantity), "fills unbalanced");
        assert_eq!(side_sum(arr, SIDE_BUY, |o| o.quote_amount), side_sum(arr, SIDE_SELL, |o| o.quote_amount), "quote unbalanced");
        for o in arr.iter().filter(|o| o.active != 0 && o.side == SIDE_BUY) {
            assert!(o.quote_amount <= escrow_for_buy(o.quantity, o.limit_price, decimals), "buyer charged beyond escrow");
        }
    }

    #[test]
    fn simple_cross() {
        // Tied V at both candidates and tied |D-S| -> midpoint tie-break: 100.
        let orders = vec![order(SIDE_BUY, 105, 10), order(SIDE_SELL, 95, 10)];
        assert_eq!(find_clearing_price(&orders, None), (100, 10));
    }

    #[test]
    fn no_cross() {
        let orders = vec![order(SIDE_BUY, 90, 10), order(SIDE_SELL, 100, 10)];
        assert_eq!(find_clearing_price(&orders, None).1, 0);
    }

    #[test]
    fn pro_rata_fill_on_buy_side() {
        let orders = vec![order(SIDE_BUY, 100, 10), order(SIDE_BUY, 100, 10), order(SIDE_SELL, 100, 10)];
        let (p, v) = find_clearing_price(&orders, None);
        assert_eq!((p, v), (100, 10));
        let mut arr = book(orders);
        assign_fills(&mut arr, p, v);
        assert_eq!([arr[0].filled_quantity, arr[1].filled_quantity, arr[2].filled_quantity], [5, 5, 10]);
    }

    #[test]
    fn strictly_better_orders_fill_first() {
        // Clearing lands at the midpoint (95) between tied candidates 90 and 100,
        // where no order sits -- exercises the general tiered fill path.
        let orders = vec![order(SIDE_BUY, 110, 5), order(SIDE_BUY, 100, 10), order(SIDE_SELL, 90, 10)];
        let (p, v) = find_clearing_price(&orders, None);
        assert_eq!((p, v), (95, 10));
        let mut arr = book(orders);
        assign_fills(&mut arr, p, v);
        assert_eq!([arr[0].filled_quantity, arr[1].filled_quantity, arr[2].filled_quantity], [5, 5, 10]);
    }

    #[test]
    fn cancelled_orders_excluded() {
        let mut orders = vec![order(SIDE_BUY, 100, 10), order(SIDE_SELL, 90, 10)];
        orders[1].cancelled = 1;
        assert_eq!(find_clearing_price(&orders, None).1, 0);
    }

    #[test]
    fn oracle_breaks_price_tie() {
        let orders = vec![order(SIDE_BUY, 110, 10), order(SIDE_SELL, 90, 10)];
        assert_eq!(find_clearing_price(&orders, None).0, 100);
        assert_eq!(find_clearing_price(&orders, Some(91)).0, 90);
    }

    #[test]
    fn empty_book() {
        assert_eq!(find_clearing_price(&[], None), (0, 0));
    }

    #[test]
    fn never_fills_more_than_executable_volume() {
        let orders = vec![order(SIDE_BUY, 200, 3), order(SIDE_BUY, 150, 4), order(SIDE_SELL, 50, 5), order(SIDE_SELL, 60, 2)];
        let (p, v) = find_clearing_price(&orders, None);
        let mut arr = book(orders);
        assign_fills(&mut arr, p, v);
        assert_eq!(arr[0].filled_quantity + arr[1].filled_quantity, v);
        assert_eq!(arr[2].filled_quantity + arr[3].filled_quantity, v);
    }

    #[test]
    fn both_sides_fill_to_the_same_total() {
        // floor(10 * 200/220) = 9 per buyer -> 198 against the sell side's 200
        // without remainder redistribution: settlement would pay out more than
        // it collected.
        let mut v = Vec::new();
        for _ in 0..22 { v.push(order(SIDE_BUY, 100, 10)); }
        for _ in 0..18 { v.push(order(SIDE_SELL, 90, 10)); }
        for _ in 0..2 { v.push(order(SIDE_SELL, 100, 10)); }
        let (arr, p, vol) = clear(v, 8);
        assert_eq!((p, vol), (100, 200));
        assert_eq!(side_sum(&arr, SIDE_BUY, |o| o.filled_quantity), 200);
        check_balanced(&arr, 8);
    }

    #[test]
    fn realistic_book_balances_at_a_non_round_price() {
        let mut v = Vec::new();
        for _ in 0..22 { v.push(order(SIDE_BUY, 100_370_000, 10 * 100_000_000)); }
        for _ in 0..18 { v.push(order(SIDE_SELL, 90_000_000, 10 * 100_000_000)); }
        for _ in 0..2 { v.push(order(SIDE_SELL, 100_370_000, 10 * 100_000_000)); }
        let (arr, p, vol) = clear(v, 8);
        assert_eq!((p, vol), (100_370_000, 200 * 100_000_000));
        check_balanced(&arr, 8);
    }

    #[test]
    fn per_order_floor_cannot_starve_the_seller() {
        // Two buyers each owing 0.5 atomic quote units against one seller owed
        // 1.0: flooring each buyer independently would collect 0 and pay 1.
        let price = 50_000_000;
        let v = vec![order(SIDE_BUY, price, 1), order(SIDE_BUY, price, 1), order(SIDE_SELL, price, 2)];
        let (arr, _, vol) = clear(v, 8);
        assert_eq!(vol, 2);
        check_balanced(&arr, 8);
        assert_eq!(arr[2].quote_amount, 1);
    }
}
