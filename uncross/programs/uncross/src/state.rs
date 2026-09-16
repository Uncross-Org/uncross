use anchor_lang::prelude::*;

/// 63, not 64: the 64th summary slot's 40 bytes now hold `payer` and padding,
/// so the account stays 2880 bytes and every auction created before
/// close_auction existed still loads under this layout. No live auction has
/// ever used slot 63 (the largest book run is 42 orders), and in those legacy
/// accounts the bytes are zero, which reads as "payer unknown".
pub const MAX_ORDERS: usize = 63;

pub const SIDE_BUY: u8 = 0;
pub const SIDE_SELL: u8 = 1;

pub const STATUS_OPEN: u8 = 0;
pub const STATUS_CLEARED: u8 = 1;
pub const STATUS_SETTLED: u8 = 2;

/// Which way an auction is being wound down. Set by the first settle_batch or
/// cancel_and_refund call and fixed from then on: mixing the two would let a
/// seller be refunded shares that a clear-settled buyer already received.
pub const SETTLE_PATH_NONE: u8 = 0;
pub const SETTLE_PATH_CLEAR: u8 = 1;
pub const SETTLE_PATH_REFUND: u8 = 2;

#[repr(u8)]
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum Side {
    Buy = 0,
    Sell = 1,
}

/// Mirror of an Order's clearing-relevant fields, kept inline in the Auction so
/// compute_clearing runs over one account. `filled_quantity` and `quote_amount`
/// are both decided by compute_clearing; settlement only moves them.
/// `quote_amount` is what a seller receives, or what a buyer is charged, in raw
/// quote units.
#[zero_copy]
#[derive(Default, Debug)]
pub struct OrderSummary {
    pub limit_price: u64,
    pub quantity: u64,
    pub filled_quantity: u64,
    pub quote_amount: u64,
    pub active: u8,
    pub cancelled: u8,
    pub side: u8,
    pub _pad: [u8; 5],
}

impl OrderSummary {
    pub fn is_live(&self) -> bool {
        self.active != 0 && self.cancelled == 0
    }
}

/// Zero-copy so Anchor never deserializes this ~2.9KB account onto the 4KB BPF
/// stack. Fields are ordered largest-alignment-first with explicit padding so
/// the repr(C) layout has no implicit padding, which bytemuck requires.
#[account(zero_copy)]
pub struct Auction {
    pub open_slot: u64,
    pub close_slot: u64,
    pub freeze_slots: u64,
    pub cadence_slots: u64,
    pub clearing_price: u64,
    pub executable_volume: u64,
    pub reference_price: u64,
    pub indicative_price: u64,
    pub indicative_volume: u64,
    pub ticker_mint: Pubkey,
    pub quote_mint: Pubkey,
    pub ticker_token_program: Pubkey,
    pub quote_token_program: Pubkey,
    pub vault_ticker: Pubkey,
    pub vault_quote: Pubkey,
    /// Pyth feed this auction accepts as its reference price. All-zero means no
    /// oracle anchor. Bound at creation so a permissionless compute_clearing
    /// caller cannot substitute another asset's feed.
    pub pyth_feed_id: [u8; 32],
    pub protocol_fee_bps: u16,
    pub order_count: u16,
    pub settled_count: u16,
    pub ticker_decimals: u8,
    pub quote_decimals: u8,
    pub status: u8,
    pub reference_price_set: u8,
    pub bump: u8,
    pub settle_path: u8,
    /// What the Pyth gate decided at the cross: one of the GATE_* codes in
    /// oracle.rs. 0 on auctions cleared before the field existed.
    pub oracle_gate: u8,
    pub _pad: [u8; 3],
    pub orders: [OrderSummary; MAX_ORDERS],
    /// Who paid the rent for this auction and its two vaults. close_auction
    /// returns it here and nowhere else. All-zero on auctions created before
    /// the field existed; those cannot be closed, which is the safe failure.
    pub payer: Pubkey,
    /// publish_time of the Pyth price the gate examined, once it had confirmed
    /// the account was the bound feed. 0 when the gate stopped earlier, and on
    /// auctions cleared before the field existed.
    pub oracle_publish_time: i64,
}

impl Auction {
    pub const SIZE: usize = 8 + std::mem::size_of::<Auction>();
}

#[account]
pub struct Order {
    pub auction: Pubkey,
    pub owner: Pubkey,
    pub order_index: u16,
    pub side: Side,
    pub limit_price: u64,
    pub quantity: u64,
    pub escrow_amount: u64,
    pub filled_quantity: u64,
    pub cancelled: bool,
    pub settled: bool,
    pub refunded: bool,
    pub bump: u8,
}

impl Order {
    pub const SIZE: usize = 8 // discriminator
        + 32 + 32 // auction, owner
        + 2 // order_index
        + 1 // side
        + 8 + 8 + 8 + 8 // limit_price, quantity, escrow_amount, filled_quantity
        + 1 + 1 + 1 // cancelled, settled, refunded
        + 1; // bump
}

#[cfg(test)]
mod size_tests {
    use super::*;
    use anchor_lang::AccountSerialize;

    #[test]
    fn zero_copy_layout_has_no_hidden_padding() {
        assert_eq!(std::mem::size_of::<OrderSummary>(), 40);
        assert_eq!(std::mem::size_of::<Auction>(), 312 + 40 * MAX_ORDERS + 32 + 8);
        assert_eq!(Auction::SIZE, 8 + 2872);
    }

    #[test]
    fn order_size_matches_serialized_len() {
        let order = Order {
            auction: Pubkey::default(),
            owner: Pubkey::default(),
            order_index: 0,
            side: Side::Buy,
            limit_price: 0,
            quantity: 0,
            escrow_amount: 0,
            filled_quantity: 0,
            cancelled: false,
            settled: false,
            refunded: false,
            bump: 0,
        };
        let mut buf = Vec::new();
        order.try_serialize(&mut buf).unwrap();
        assert_eq!(buf.len(), Order::SIZE, "Order::SIZE must match actual serialized length");
    }
}
