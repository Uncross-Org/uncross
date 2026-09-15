use anchor_lang::prelude::*;

pub const MAX_ORDERS: usize = 64;

#[repr(u8)]
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum Side {
    Buy = 0,
    Sell = 1,
}

#[repr(u8)]
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum AuctionStatus {
    Open = 0,
    Cleared = 1,
    Settled = 2,
}

/// Lightweight mirror of an Order's clearing-relevant fields, kept inline in the
/// Auction account so compute_clearing can run as a single-account instruction
/// (touching 64 separate Order PDAs in one tx would blow the tx size limit --
/// see docs/phase0.md Q6).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct OrderSummary {
    pub active: bool,
    pub cancelled: bool,
    pub side: Side,
    pub limit_price: u64,
    pub quantity: u64,
    pub filled_quantity: u64,
}

impl Default for OrderSummary {
    fn default() -> Self {
        Self {
            active: false,
            cancelled: false,
            side: Side::Buy,
            limit_price: 0,
            quantity: 0,
            filled_quantity: 0,
        }
    }
}

impl OrderSummary {
    pub const SIZE: usize = 1 + 1 + 1 + 8 + 8 + 8;
}

#[account]
pub struct Auction {
    pub ticker_mint: Pubkey,
    pub quote_mint: Pubkey,
    pub ticker_token_program: Pubkey,
    pub quote_token_program: Pubkey,
    pub vault_ticker: Pubkey,
    pub vault_quote: Pubkey,
    pub ticker_decimals: u8,
    pub quote_decimals: u8,
    pub open_slot: u64,
    pub close_slot: u64,
    pub freeze_slots: u64,
    pub cadence_slots: u64,
    pub protocol_fee_bps: u16,
    pub status: AuctionStatus,
    pub order_count: u16,
    pub settled_count: u16,
    pub clearing_price: u64,
    pub executable_volume: u64,
    pub reference_price: u64,
    pub reference_price_set: bool,
    pub indicative_price: u64,
    pub indicative_volume: u64,
    pub bump: u8,
    pub vault_ticker_bump: u8,
    pub vault_quote_bump: u8,
    pub orders: [OrderSummary; MAX_ORDERS],
}

impl Auction {
    pub const SIZE: usize = 8 // discriminator
        + 32 * 6 // pubkeys
        + 1 + 1 // decimals
        + 8 * 4 // slots
        + 2 // protocol_fee_bps
        + 1 // status
        + 2 + 2 // order_count, settled_count
        + 8 + 8 // clearing_price, executable_volume
        + 8 + 1 // reference_price, reference_price_set
        + 8 + 8 // indicative_price, indicative_volume
        + 1 + 1 + 1 // bumps
        + OrderSummary::SIZE * MAX_ORDERS;
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
    fn auction_size_matches_serialized_len() {
        let auction = Auction {
            ticker_mint: Pubkey::default(),
            quote_mint: Pubkey::default(),
            ticker_token_program: Pubkey::default(),
            quote_token_program: Pubkey::default(),
            vault_ticker: Pubkey::default(),
            vault_quote: Pubkey::default(),
            ticker_decimals: 0,
            quote_decimals: 0,
            open_slot: 0,
            close_slot: 0,
            freeze_slots: 0,
            cadence_slots: 0,
            protocol_fee_bps: 0,
            status: AuctionStatus::Open,
            order_count: 0,
            settled_count: 0,
            clearing_price: 0,
            executable_volume: 0,
            reference_price: 0,
            reference_price_set: false,
            indicative_price: 0,
            indicative_volume: 0,
            bump: 0,
            vault_ticker_bump: 0,
            vault_quote_bump: 0,
            orders: [OrderSummary::default(); MAX_ORDERS],
        };
        let mut buf = Vec::new();
        auction.try_serialize(&mut buf).unwrap();
        assert_eq!(buf.len(), Auction::SIZE, "Auction::SIZE must match actual serialized length");
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
