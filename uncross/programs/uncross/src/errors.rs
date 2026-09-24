use anchor_lang::prelude::*;

#[error_code]
pub enum UncrossError {
    #[msg("close_slot must be after open_slot")]
    InvalidWindow,
    #[msg("freeze_slots must be smaller than the auction window")]
    FreezeTooLong,
    #[msg("auction is not accepting orders")]
    AuctionNotOpen,
    #[msg("current slot is outside the auction's open window")]
    OutsideOpenWindow,
    #[msg("auction order book is full")]
    OrderBookFull,
    #[msg("quantity must be greater than zero")]
    ZeroQuantity,
    #[msg("limit_price must be greater than zero")]
    ZeroPrice,
    #[msg("order does not belong to this auction")]
    OrderAuctionMismatch,
    #[msg("only the order owner may cancel it")]
    NotOrderOwner,
    #[msg("order is past the cancellation freeze window")]
    PastFreezeWindow,
    #[msg("order already cancelled")]
    AlreadyCancelled,
    #[msg("order already settled")]
    AlreadySettled,
    #[msg("clearing can only run after the auction closes")]
    AuctionNotClosed,
    #[msg("settlement requires clearing to have run first")]
    NotYetCleared,
    #[msg("order index out of range")]
    OrderIndexOutOfRange,
    #[msg("too many orders in one settlement batch")]
    BatchTooLarge,
    #[msg("math overflow")]
    MathOverflow,
    #[msg("wrong token account for this order's owner")]
    WrongMint,
    #[msg("order_index must equal the auction's current order count")]
    OrderIndexMismatch,
    #[msg("auction is already being wound down on the other settlement path")]
    SettlementPathLocked,
    #[msg("auction can only be closed once every order is settled")]
    AuctionNotSettled,
    #[msg("auction can only be closed once both vaults are empty")]
    VaultNotEmpty,
    #[msg("rent can only be returned to the account that paid it")]
    WrongRentRecipient,
    #[msg("auction predates rent tracking and cannot be closed")]
    UnknownRentPayer,
    #[msg("the refund path is only for when settlement cannot run: the mint must be paused")]
    RefundNotAllowed,
}
