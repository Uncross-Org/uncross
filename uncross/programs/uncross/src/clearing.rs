use crate::state::{OrderSummary, Side, MAX_ORDERS};

/// Sum of buy quantities with limit_price >= p.
fn demand_at(orders: &[OrderSummary], p: u64) -> u64 {
    orders
        .iter()
        .filter(|o| o.active && !o.cancelled && o.side == Side::Buy && o.limit_price >= p)
        .fold(0u64, |acc, o| acc.saturating_add(o.quantity))
}

/// Sum of sell quantities with limit_price <= p.
fn supply_at(orders: &[OrderSummary], p: u64) -> u64 {
    orders
        .iter()
        .filter(|o| o.active && !o.cancelled && o.side == Side::Sell && o.limit_price <= p)
        .fold(0u64, |acc, o| acc.saturating_add(o.quantity))
}

fn candidate_prices(orders: &[OrderSummary]) -> Vec<u64> {
    let mut prices: Vec<u64> = orders
        .iter()
        .filter(|o| o.active && !o.cancelled)
        .map(|o| o.limit_price)
        .collect();
    prices.sort_unstable();
    prices.dedup();
    prices
}

/// Uniform-price double-auction clearing price, per docs/phase0.md Phase 1 spec:
/// argmax over candidate prices of V(p) = min(Demand(p), Supply(p)), tie-broken by
/// (1) minimal |Demand(p) - Supply(p)|, then (2) nearest to a fresh oracle price if
/// one is supplied, then (3) the midpoint of the still-tied range.
///
/// Returns (clearing_price, executable_volume), with executable_volume always
/// freshly recomputed as min(Demand(p_star), Supply(p_star)) at the *final* p_star
/// -- important because the midpoint tie-break (3) can land strictly between two
/// real order prices, where demand/supply differ from either tied candidate's own
/// V in general (they happen to agree in the common two-candidate case, but this
/// keeps assign_fills' invariant -- total filled per side never exceeds
/// executable_volume -- true unconditionally).
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
        // No candidate clears any volume; report the lowest candidate with V=0.
        return (candidates[0], 0);
    }

    let p_star = if best.len() == 1 {
        best[0]
    } else {
        // Tie-break 1: minimise |Demand(p) - Supply(p)|.
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
            // Tie-break 2: nearest to a fresh oracle price.
            *gap_ties
                .iter()
                .min_by_key(|&&p| (p as i128 - oracle_p as i128).abs())
                .unwrap()
        } else {
            // Tie-break 3: midpoint of the tied range.
            let lo = *gap_ties.iter().min().unwrap();
            let hi = *gap_ties.iter().max().unwrap();
            lo + (hi - lo) / 2
        }
    };

    let v_star = demand_at(orders, p_star).min(supply_at(orders, p_star));
    (p_star, v_star)
}

/// Writes filled_quantity into every active, non-cancelled order for the given
/// clearing price / executable volume. Within each side, orders are filled in
/// strict price priority (best price first) up to v_star; the single marginal
/// price tier where the cutoff falls is pro-rated (floor division -- any
/// rounding dust stays as an unused escrow remainder, refunded at settlement).
/// This is the general form and does not assume p_star is itself one of the
/// order book's own limit prices (see find_clearing_price's doc comment on the
/// midpoint tie-break).
pub fn assign_fills(orders: &mut [OrderSummary; MAX_ORDERS], p_star: u64, v_star: u64) {
    for o in orders.iter_mut() {
        if o.active {
            o.filled_quantity = 0;
        }
    }
    if v_star == 0 {
        return;
    }

    fill_side(orders, Side::Buy, p_star, v_star);
    fill_side(orders, Side::Sell, p_star, v_star);
}

fn fill_side(orders: &mut [OrderSummary; MAX_ORDERS], side: Side, p_star: u64, v_star: u64) {
    let mut idxs: Vec<usize> = (0..orders.len())
        .filter(|&i| {
            let o = &orders[i];
            o.active
                && !o.cancelled
                && o.side == side
                && match side {
                    Side::Buy => o.limit_price >= p_star,
                    Side::Sell => o.limit_price <= p_star,
                }
        })
        .collect();

    // Best price first: highest for buys, lowest for sells.
    idxs.sort_by(|&a, &b| match side {
        Side::Buy => orders[b].limit_price.cmp(&orders[a].limit_price),
        Side::Sell => orders[a].limit_price.cmp(&orders[b].limit_price),
    });

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
            for &k in &idxs[i..j] {
                let q = orders[k].quantity as u128;
                orders[k].filled_quantity = (q * remaining as u128 / tier_total as u128) as u64;
            }
            remaining = 0;
        }
        i = j;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn order(side: Side, limit_price: u64, quantity: u64) -> OrderSummary {
        OrderSummary {
            active: true,
            cancelled: false,
            side,
            limit_price,
            quantity,
            filled_quantity: 0,
        }
    }

    fn book(orders: Vec<OrderSummary>) -> [OrderSummary; MAX_ORDERS] {
        let mut arr = [OrderSummary::default(); MAX_ORDERS];
        for (i, o) in orders.into_iter().enumerate() {
            arr[i] = o;
        }
        arr
    }

    #[test]
    fn simple_cross() {
        // Buy 10 @ 105, Sell 10 @ 95 -> tied V at both candidates, gap tied too
        // (D=S at both) -> falls through to the midpoint tie-break: 100.
        let orders = vec![order(Side::Buy, 105, 10), order(Side::Sell, 95, 10)];
        let (p, v) = find_clearing_price(&orders, None);
        assert_eq!(v, 10);
        assert_eq!(p, 100);
    }

    #[test]
    fn no_cross() {
        let orders = vec![order(Side::Buy, 90, 10), order(Side::Sell, 100, 10)];
        let (_p, v) = find_clearing_price(&orders, None);
        assert_eq!(v, 0);
    }

    #[test]
    fn pro_rata_fill_on_buy_side() {
        // Two buys at the clearing price for 10 each, one sell for 10 at a lower
        // price -> both buys should split the 10 units 50/50.
        let orders = vec![
            order(Side::Buy, 100, 10),
            order(Side::Buy, 100, 10),
            order(Side::Sell, 100, 10),
        ];
        let (p, v) = find_clearing_price(&orders, None);
        assert_eq!(p, 100);
        assert_eq!(v, 10);

        let mut arr = book(orders);
        assign_fills(&mut arr, p, v);
        assert_eq!(arr[0].filled_quantity, 5);
        assert_eq!(arr[1].filled_quantity, 5);
        assert_eq!(arr[2].filled_quantity, 10);
    }

    #[test]
    fn strictly_better_orders_fill_first() {
        // Clearing price lands at the midpoint (95) between the two tied
        // candidates (90, 100) -- neither buy order sits exactly at 95, so this
        // exercises the general tiered-priority fill path, not just the
        // candidate-price shortcut.
        let orders = vec![
            order(Side::Buy, 110, 5),  // best price -> fills in full first
            order(Side::Buy, 100, 10), // marginal tier -> pro-rata
            order(Side::Sell, 90, 10),
        ];
        let (p, v) = find_clearing_price(&orders, None);
        assert_eq!(p, 95);
        assert_eq!(v, 10);

        let mut arr = book(orders);
        assign_fills(&mut arr, p, v);
        assert_eq!(arr[0].filled_quantity, 5);
        assert_eq!(arr[1].filled_quantity, 5);
        assert_eq!(arr[0].filled_quantity + arr[1].filled_quantity, v);
        assert_eq!(arr[2].filled_quantity, 10);
    }

    #[test]
    fn cancelled_orders_excluded() {
        let mut orders = vec![order(Side::Buy, 100, 10), order(Side::Sell, 90, 10)];
        orders[1].cancelled = true;
        let (_p, v) = find_clearing_price(&orders, None);
        assert_eq!(v, 0);
    }

    #[test]
    fn oracle_breaks_price_tie() {
        // Two candidate prices both clear the same volume; oracle should pick the
        // nearer one once the |D-S| tie-break also ties.
        let orders = vec![order(Side::Buy, 110, 10), order(Side::Sell, 90, 10)];
        let (p_no_oracle, _) = find_clearing_price(&orders, None);
        let (p_with_oracle, _) = find_clearing_price(&orders, Some(91));
        assert!(p_no_oracle == 90 || p_no_oracle == 100 || p_no_oracle == 110);
        assert_eq!(p_with_oracle, 90);
    }

    #[test]
    fn empty_book() {
        let orders: Vec<OrderSummary> = vec![];
        let (p, v) = find_clearing_price(&orders, None);
        assert_eq!(p, 0);
        assert_eq!(v, 0);
    }

    #[test]
    fn never_fills_more_than_executable_volume() {
        // Regression check for the bug the fix above addresses: total filled on
        // each side must never exceed v_star, even when p_star is a synthetic
        // midpoint that doesn't equal any real order's limit_price.
        let orders = vec![
            order(Side::Buy, 200, 3),
            order(Side::Buy, 150, 4),
            order(Side::Sell, 50, 5),
            order(Side::Sell, 60, 2),
        ];
        let (p, v) = find_clearing_price(&orders, None);
        let mut arr = book(orders);
        assign_fills(&mut arr, p, v);
        let buy_filled: u64 = arr[0].filled_quantity + arr[1].filled_quantity;
        let sell_filled: u64 = arr[2].filled_quantity + arr[3].filled_quantity;
        assert_eq!(buy_filled, v);
        assert_eq!(sell_filled, v);
    }
}
