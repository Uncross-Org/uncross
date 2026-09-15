use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked};

mod clearing;
mod errors;
mod oracle;
mod state;

use errors::UncrossError;
use state::{Auction, AuctionStatus, Order, OrderSummary, Side, MAX_ORDERS};

declare_id!("Gk9ZUMqPcNuF3PduisUZXBffUP7cCrfnBSCAyTdpjYGP");

/// Maximum orders settled in a single settle_batch / cancel_and_refund call.
/// Measured, not estimated -- see docs/phase0.md Q6: a plain (no address-lookup-table)
/// transaction fits ~18-19 TransferChecked instructions against distinct counterparty
/// ATAs before the 1232-byte wire limit is hit. Each settled order costs 2 transfers.
pub const MAX_BATCH: usize = 18;

/// Freshness window (seconds) for a Pyth equity price to count as "Trading" per
/// docs/phase0.md Q3. Outside US market hours this will normally fail the gate,
/// which is expected and handled (auction proceeds without an oracle anchor).
pub const ORACLE_MAX_AGE_SECS: u64 = 90;

#[program]
pub mod uncross {
    use super::*;

    pub fn initialize_auction(
        ctx: Context<InitializeAuction>,
        open_slot: u64,
        close_slot: u64,
        freeze_slots: u64,
        cadence_slots: u64,
    ) -> Result<()> {
        require!(close_slot > open_slot, UncrossError::InvalidWindow);
        require!(
            freeze_slots < close_slot - open_slot,
            UncrossError::FreezeTooLong
        );

        let auction = &mut ctx.accounts.auction;
        auction.ticker_mint = ctx.accounts.ticker_mint.key();
        auction.quote_mint = ctx.accounts.quote_mint.key();
        auction.ticker_token_program = ctx.accounts.ticker_token_program.key();
        auction.quote_token_program = ctx.accounts.quote_token_program.key();
        auction.vault_ticker = ctx.accounts.vault_ticker.key();
        auction.vault_quote = ctx.accounts.vault_quote.key();
        auction.ticker_decimals = ctx.accounts.ticker_mint.decimals;
        auction.quote_decimals = ctx.accounts.quote_mint.decimals;
        auction.open_slot = open_slot;
        auction.close_slot = close_slot;
        auction.freeze_slots = freeze_slots;
        auction.cadence_slots = cadence_slots;
        auction.protocol_fee_bps = 0; // present but unused, per spec
        auction.status = AuctionStatus::Open;
        auction.order_count = 0;
        auction.settled_count = 0;
        auction.clearing_price = 0;
        auction.executable_volume = 0;
        auction.reference_price = 0;
        auction.reference_price_set = false;
        auction.indicative_price = 0;
        auction.indicative_volume = 0;
        auction.bump = ctx.bumps.auction;
        auction.vault_ticker_bump = 0;
        auction.vault_quote_bump = 0;
        auction.orders = [OrderSummary::default(); MAX_ORDERS];

        Ok(())
    }

    pub fn place_order(
        ctx: Context<PlaceOrder>,
        side: Side,
        limit_price: u64,
        quantity: u64,
    ) -> Result<()> {
        let clock = Clock::get()?;
        require!(quantity > 0, UncrossError::ZeroQuantity);
        require!(limit_price > 0, UncrossError::ZeroPrice);
        {
            let auction = &ctx.accounts.auction;
            require!(
                auction.status == AuctionStatus::Open,
                UncrossError::AuctionNotOpen
            );
            require!(
                clock.slot >= auction.open_slot && clock.slot < auction.close_slot,
                UncrossError::OutsideOpenWindow
            );
            require!(
                (auction.order_count as usize) < MAX_ORDERS,
                UncrossError::OrderBookFull
            );
        }

        let ticker_decimals = ctx.accounts.auction.ticker_decimals;
        let quote_decimals = ctx.accounts.auction.quote_decimals;
        let escrow_amount: u64 = match side {
            Side::Buy => {
                let numerator = (quantity as u128) * (limit_price as u128);
                let divisor = 10u128.pow(ticker_decimals as u32);
                (numerator / divisor) as u64
            }
            Side::Sell => quantity,
        };
        require!(escrow_amount > 0, UncrossError::ZeroQuantity);

        match side {
            Side::Buy => {
                let cpi_accounts = TransferChecked {
                    from: ctx.accounts.owner_quote_ata.to_account_info(),
                    mint: ctx.accounts.quote_mint.to_account_info(),
                    to: ctx.accounts.vault_quote.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                };
                let cpi_ctx = CpiContext::new(
                    ctx.accounts.quote_token_program.to_account_info(),
                    cpi_accounts,
                );
                transfer_checked(cpi_ctx, escrow_amount, quote_decimals)?;
            }
            Side::Sell => {
                let cpi_accounts = TransferChecked {
                    from: ctx.accounts.owner_ticker_ata.to_account_info(),
                    mint: ctx.accounts.ticker_mint.to_account_info(),
                    to: ctx.accounts.vault_ticker.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                };
                let cpi_ctx = CpiContext::new(
                    ctx.accounts.ticker_token_program.to_account_info(),
                    cpi_accounts,
                );
                transfer_checked(cpi_ctx, escrow_amount, ticker_decimals)?;
            }
        }

        let order_index = ctx.accounts.auction.order_count;
        let order = &mut ctx.accounts.order;
        order.auction = ctx.accounts.auction.key();
        order.owner = ctx.accounts.owner.key();
        order.order_index = order_index;
        order.side = side;
        order.limit_price = limit_price;
        order.quantity = quantity;
        order.escrow_amount = escrow_amount;
        order.filled_quantity = 0;
        order.cancelled = false;
        order.settled = false;
        order.refunded = false;
        order.bump = ctx.bumps.order;

        let auction = &mut ctx.accounts.auction;
        auction.orders[order_index as usize] = OrderSummary {
            active: true,
            cancelled: false,
            side,
            limit_price,
            quantity,
            filled_quantity: 0,
        };
        auction.order_count = order_index
            .checked_add(1)
            .ok_or(UncrossError::MathOverflow)?;

        let (p, v) = clearing::find_clearing_price(&auction.orders[..], None);
        auction.indicative_price = p;
        auction.indicative_volume = v;

        Ok(())
    }

    pub fn cancel_order(ctx: Context<CancelOrder>) -> Result<()> {
        let clock = Clock::get()?;
        let close_slot = ctx.accounts.auction.close_slot;
        let freeze_slots = ctx.accounts.auction.freeze_slots;
        require!(
            clock.slot < close_slot.saturating_sub(freeze_slots),
            UncrossError::PastFreezeWindow
        );
        require!(!ctx.accounts.order.cancelled, UncrossError::AlreadyCancelled);
        require!(!ctx.accounts.order.settled, UncrossError::AlreadySettled);

        let side = ctx.accounts.order.side;
        let escrow_amount = ctx.accounts.order.escrow_amount;
        let order_index = ctx.accounts.order.order_index;

        let ticker_mint_key = ctx.accounts.auction.ticker_mint;
        let open_slot = ctx.accounts.auction.open_slot;
        let auction_bump = ctx.accounts.auction.bump;
        let ticker_decimals = ctx.accounts.auction.ticker_decimals;
        let quote_decimals = ctx.accounts.auction.quote_decimals;
        let open_slot_bytes = open_slot.to_le_bytes();
        let signer_seeds: &[&[u8]] = &[
            b"auction",
            ticker_mint_key.as_ref(),
            open_slot_bytes.as_ref(),
            &[auction_bump],
        ];
        let signer_seeds_arr = [signer_seeds];

        match side {
            Side::Buy => {
                let cpi_accounts = TransferChecked {
                    from: ctx.accounts.vault_quote.to_account_info(),
                    mint: ctx.accounts.quote_mint.to_account_info(),
                    to: ctx.accounts.owner_quote_ata.to_account_info(),
                    authority: ctx.accounts.auction.to_account_info(),
                };
                let cpi_ctx = CpiContext::new_with_signer(
                    ctx.accounts.quote_token_program.to_account_info(),
                    cpi_accounts,
                    &signer_seeds_arr,
                );
                transfer_checked(cpi_ctx, escrow_amount, quote_decimals)?;
            }
            Side::Sell => {
                let cpi_accounts = TransferChecked {
                    from: ctx.accounts.vault_ticker.to_account_info(),
                    mint: ctx.accounts.ticker_mint.to_account_info(),
                    to: ctx.accounts.owner_ticker_ata.to_account_info(),
                    authority: ctx.accounts.auction.to_account_info(),
                };
                let cpi_ctx = CpiContext::new_with_signer(
                    ctx.accounts.ticker_token_program.to_account_info(),
                    cpi_accounts,
                    &signer_seeds_arr,
                );
                transfer_checked(cpi_ctx, escrow_amount, ticker_decimals)?;
            }
        }

        let order = &mut ctx.accounts.order;
        order.cancelled = true;
        order.refunded = true;
        order.settled = true;

        let auction = &mut ctx.accounts.auction;
        auction.orders[order_index as usize].cancelled = true;
        auction.orders[order_index as usize].filled_quantity = 0;
        auction.settled_count = auction.settled_count.saturating_add(1);

        let (p, v) = clearing::find_clearing_price(&auction.orders[..], None);
        auction.indicative_price = p;
        auction.indicative_volume = v;

        Ok(())
    }

    /// Permissionless / crank-callable. Idempotent: a call after the auction is
    /// already Cleared or Settled is a no-op rather than an error.
    pub fn compute_clearing(ctx: Context<ComputeClearing>) -> Result<()> {
        let clock = Clock::get()?;

        if ctx.accounts.auction.status != AuctionStatus::Open {
            return Ok(());
        }
        require!(
            clock.slot >= ctx.accounts.auction.close_slot,
            UncrossError::AuctionNotClosed
        );

        let oracle_price = oracle::read_fresh_price(&ctx.accounts.pyth_price_feed, &clock);

        let auction = &mut ctx.accounts.auction;
        auction.reference_price_set = oracle_price.is_some();
        auction.reference_price = oracle_price.unwrap_or(0);

        let (p_star, v_star) = clearing::find_clearing_price(&auction.orders[..], oracle_price);
        clearing::assign_fills(&mut auction.orders, p_star, v_star);

        auction.clearing_price = p_star;
        auction.executable_volume = v_star;
        auction.indicative_price = p_star;
        auction.indicative_volume = v_star;
        auction.status = AuctionStatus::Cleared;

        Ok(())
    }

    /// Crank-callable, permissionless. Settles up to MAX_BATCH orders per call
    /// using the fills computed by compute_clearing. remaining_accounts must be
    /// laid out as [order, owner_ticker_ata, owner_quote_ata] repeated once per
    /// entry in order_indices.
    pub fn settle_batch<'info>(
        ctx: Context<'_, '_, 'info, 'info, SettleAccounts<'info>>,
        order_indices: Vec<u16>,
    ) -> Result<()> {
        settle_or_refund(ctx, order_indices, SettleMode::Clear)
    }

    /// Failure path: refunds an order's full original escrow without regard to
    /// any computed fill. Callable on any order that has not yet been settled --
    /// e.g. because settle_batch's token transfer keeps failing (mint paused).
    pub fn cancel_and_refund<'info>(
        ctx: Context<'_, '_, 'info, 'info, SettleAccounts<'info>>,
        order_indices: Vec<u16>,
    ) -> Result<()> {
        settle_or_refund(ctx, order_indices, SettleMode::Refund)
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum SettleMode {
    Clear,
    Refund,
}

fn settle_or_refund<'info>(
    ctx: Context<'_, '_, 'info, 'info, SettleAccounts<'info>>,
    order_indices: Vec<u16>,
    mode: SettleMode,
) -> Result<()> {
    require!(
        !order_indices.is_empty() && order_indices.len() <= MAX_BATCH,
        UncrossError::BatchTooLarge
    );
    require!(
        ctx.accounts.auction.status != AuctionStatus::Open,
        UncrossError::NotYetCleared
    );
    require!(
        ctx.remaining_accounts.len() == order_indices.len() * 3,
        UncrossError::OrderIndexOutOfRange
    );

    let auction_key = ctx.accounts.auction.key();
    let ticker_mint_key = ctx.accounts.auction.ticker_mint;
    let open_slot = ctx.accounts.auction.open_slot;
    let auction_bump = ctx.accounts.auction.bump;
    let clearing_price = ctx.accounts.auction.clearing_price;
    let ticker_decimals = ctx.accounts.auction.ticker_decimals;
    let quote_decimals = ctx.accounts.auction.quote_decimals;
    let ticker_mint_ai = ctx.accounts.ticker_mint.to_account_info();
    let quote_mint_ai = ctx.accounts.quote_mint.to_account_info();
    let ticker_program_ai = ctx.accounts.ticker_token_program.to_account_info();
    let quote_program_ai = ctx.accounts.quote_token_program.to_account_info();
    let vault_ticker_ai = ctx.accounts.vault_ticker.to_account_info();
    let vault_quote_ai = ctx.accounts.vault_quote.to_account_info();
    let auction_ai = ctx.accounts.auction.to_account_info();

    let open_slot_bytes = open_slot.to_le_bytes();
    let signer_seeds: &[&[u8]] = &[
        b"auction",
        ticker_mint_key.as_ref(),
        open_slot_bytes.as_ref(),
        &[auction_bump],
    ];
    let signer_seeds_arr = [signer_seeds];

    let mut newly_settled: u16 = 0;

    for (i, &order_index) in order_indices.iter().enumerate() {
        require!(
            (order_index as usize) < MAX_ORDERS,
            UncrossError::OrderIndexOutOfRange
        );

        let order_ai = &ctx.remaining_accounts[i * 3];
        let owner_ticker_ata_ai = &ctx.remaining_accounts[i * 3 + 1];
        let owner_quote_ata_ai = &ctx.remaining_accounts[i * 3 + 2];

        let (expected_order_pda, _) = Pubkey::find_program_address(
            &[
                b"order",
                auction_key.as_ref(),
                order_index.to_le_bytes().as_ref(),
            ],
            ctx.program_id,
        );
        require_keys_eq!(
            order_ai.key(),
            expected_order_pda,
            UncrossError::OrderIndexOutOfRange
        );

        let mut order: Account<Order> = Account::try_from(order_ai)?;
        require!(
            order.auction == auction_key,
            UncrossError::OrderAuctionMismatch
        );

        if order.settled {
            continue;
        }

        let expected_ticker_ata = anchor_spl::associated_token::get_associated_token_address_with_program_id(
            &order.owner,
            &ticker_mint_key,
            &ctx.accounts.ticker_token_program.key(),
        );
        require_keys_eq!(
            owner_ticker_ata_ai.key(),
            expected_ticker_ata,
            UncrossError::WrongMint
        );
        let expected_quote_ata = anchor_spl::associated_token::get_associated_token_address_with_program_id(
            &order.owner,
            &ctx.accounts.auction.quote_mint,
            &ctx.accounts.quote_token_program.key(),
        );
        require_keys_eq!(
            owner_quote_ata_ai.key(),
            expected_quote_ata,
            UncrossError::WrongMint
        );

        let filled = ctx.accounts.auction.orders[order_index as usize].filled_quantity;

        match mode {
            SettleMode::Clear => match order.side {
                Side::Buy => {
                    let charge_quote = ((filled as u128) * (clearing_price as u128)
                        / 10u128.pow(ticker_decimals as u32)) as u64;
                    let refund_quote = order.escrow_amount.saturating_sub(charge_quote);

                    if filled > 0 {
                        let cpi_accounts = TransferChecked {
                            from: vault_ticker_ai.clone(),
                            mint: ticker_mint_ai.clone(),
                            to: owner_ticker_ata_ai.clone(),
                            authority: auction_ai.clone(),
                        };
                        let cpi_ctx = CpiContext::new_with_signer(
                            ticker_program_ai.clone(),
                            cpi_accounts,
                            &signer_seeds_arr,
                        );
                        transfer_checked(cpi_ctx, filled, ticker_decimals)?;
                    }
                    if refund_quote > 0 {
                        let cpi_accounts = TransferChecked {
                            from: vault_quote_ai.clone(),
                            mint: quote_mint_ai.clone(),
                            to: owner_quote_ata_ai.clone(),
                            authority: auction_ai.clone(),
                        };
                        let cpi_ctx = CpiContext::new_with_signer(
                            quote_program_ai.clone(),
                            cpi_accounts,
                            &signer_seeds_arr,
                        );
                        transfer_checked(cpi_ctx, refund_quote, quote_decimals)?;
                    }
                }
                Side::Sell => {
                    let receive_quote = ((filled as u128) * (clearing_price as u128)
                        / 10u128.pow(ticker_decimals as u32)) as u64;
                    let refund_ticker = order.quantity.saturating_sub(filled);

                    if receive_quote > 0 {
                        let cpi_accounts = TransferChecked {
                            from: vault_quote_ai.clone(),
                            mint: quote_mint_ai.clone(),
                            to: owner_quote_ata_ai.clone(),
                            authority: auction_ai.clone(),
                        };
                        let cpi_ctx = CpiContext::new_with_signer(
                            quote_program_ai.clone(),
                            cpi_accounts,
                            &signer_seeds_arr,
                        );
                        transfer_checked(cpi_ctx, receive_quote, quote_decimals)?;
                    }
                    if refund_ticker > 0 {
                        let cpi_accounts = TransferChecked {
                            from: vault_ticker_ai.clone(),
                            mint: ticker_mint_ai.clone(),
                            to: owner_ticker_ata_ai.clone(),
                            authority: auction_ai.clone(),
                        };
                        let cpi_ctx = CpiContext::new_with_signer(
                            ticker_program_ai.clone(),
                            cpi_accounts,
                            &signer_seeds_arr,
                        );
                        transfer_checked(cpi_ctx, refund_ticker, ticker_decimals)?;
                    }
                }
            },
            SettleMode::Refund => {
                match order.side {
                    Side::Buy => {
                        if order.escrow_amount > 0 {
                            let cpi_accounts = TransferChecked {
                                from: vault_quote_ai.clone(),
                                mint: quote_mint_ai.clone(),
                                to: owner_quote_ata_ai.clone(),
                                authority: auction_ai.clone(),
                            };
                            let cpi_ctx = CpiContext::new_with_signer(
                                quote_program_ai.clone(),
                                cpi_accounts,
                                &signer_seeds_arr,
                            );
                            transfer_checked(cpi_ctx, order.escrow_amount, quote_decimals)?;
                        }
                    }
                    Side::Sell => {
                        if order.escrow_amount > 0 {
                            let cpi_accounts = TransferChecked {
                                from: vault_ticker_ai.clone(),
                                mint: ticker_mint_ai.clone(),
                                to: owner_ticker_ata_ai.clone(),
                                authority: auction_ai.clone(),
                            };
                            let cpi_ctx = CpiContext::new_with_signer(
                                ticker_program_ai.clone(),
                                cpi_accounts,
                                &signer_seeds_arr,
                            );
                            transfer_checked(cpi_ctx, order.escrow_amount, ticker_decimals)?;
                        }
                    }
                }
                order.refunded = true;
            }
        }

        order.settled = true;
        order.exit(ctx.program_id)?;
        newly_settled = newly_settled.saturating_add(1);
    }

    let auction = &mut ctx.accounts.auction;
    auction.settled_count = auction.settled_count.saturating_add(newly_settled);
    if auction.settled_count >= auction.order_count {
        auction.status = AuctionStatus::Settled;
    }

    Ok(())
}

#[derive(Accounts)]
#[instruction(open_slot: u64)]
pub struct InitializeAuction<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = Auction::SIZE,
        seeds = [b"auction", ticker_mint.key().as_ref(), open_slot.to_le_bytes().as_ref()],
        bump,
    )]
    pub auction: Box<Account<'info, Auction>>,

    pub ticker_mint: Box<InterfaceAccount<'info, Mint>>,
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = payer,
        associated_token::mint = ticker_mint,
        associated_token::authority = auction,
        associated_token::token_program = ticker_token_program,
    )]
    pub vault_ticker: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init,
        payer = payer,
        associated_token::mint = quote_mint,
        associated_token::authority = auction,
        associated_token::token_program = quote_token_program,
    )]
    pub vault_quote: Box<InterfaceAccount<'info, TokenAccount>>,

    pub ticker_token_program: Interface<'info, TokenInterface>,
    pub quote_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PlaceOrder<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(mut)]
    pub auction: Box<Account<'info, Auction>>,

    #[account(
        init,
        payer = owner,
        space = Order::SIZE,
        seeds = [b"order", auction.key().as_ref(), auction.order_count.to_le_bytes().as_ref()],
        bump,
    )]
    pub order: Box<Account<'info, Order>>,

    /// CHECK: address-constrained against auction.vault_ticker; left
    /// unchecked (not deserialized as a typed token account) to keep this
    /// struct's stack frame under the BPF 4096-byte limit -- see owner_ticker_ata.
    #[account(mut, address = auction.vault_ticker)]
    pub vault_ticker: UncheckedAccount<'info>,
    /// CHECK: address-constrained against auction.vault_quote; see vault_ticker.
    #[account(mut, address = auction.vault_quote)]
    pub vault_quote: UncheckedAccount<'info>,

    /// Must already exist -- see docs/phase1.md setup notes. Left as an
    /// UncheckedAccount (address-derived, not deserialized as a typed token
    /// account) to keep this struct's BPF stack frame under the 4096-byte
    /// limit; deserializing every account here as a full Token-2022
    /// TokenAccount (with extensions) was what pushed try_accounts over.
    /// CHECK: address is the canonical ATA for (owner, ticker_mint, ticker_token_program).
    #[account(mut, address = anchor_spl::associated_token::get_associated_token_address_with_program_id(&owner.key(), &ticker_mint.key(), &ticker_token_program.key()))]
    pub owner_ticker_ata: UncheckedAccount<'info>,
    /// CHECK: address is the canonical ATA for (owner, quote_mint, quote_token_program).
    #[account(mut, address = anchor_spl::associated_token::get_associated_token_address_with_program_id(&owner.key(), &quote_mint.key(), &quote_token_program.key()))]
    pub owner_quote_ata: UncheckedAccount<'info>,

    /// Decimals come from auction.ticker_decimals (recorded at
    /// initialize_auction), not from deserializing this account. The mint
    /// identity itself is enforced by the SPL Token program's own
    /// transfer_checked check (it requires this account's key to match the
    /// mint recorded in both the source and destination token accounts), so
    /// no redundant Anchor-level address constraint is needed here -- one
    /// less check in this struct's already-tight BPF stack frame.
    /// CHECK: see comment above; enforced transitively by transfer_checked.
    pub ticker_mint: UncheckedAccount<'info>,
    /// CHECK: see ticker_mint.
    pub quote_mint: UncheckedAccount<'info>,
    #[account(address = auction.ticker_token_program)]
    pub ticker_token_program: Interface<'info, TokenInterface>,
    #[account(address = auction.quote_token_program)]
    pub quote_token_program: Interface<'info, TokenInterface>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelOrder<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(mut)]
    pub auction: Box<Account<'info, Auction>>,

    #[account(
        mut,
        seeds = [b"order", auction.key().as_ref(), order.order_index.to_le_bytes().as_ref()],
        bump = order.bump,
        constraint = order.auction == auction.key() @ UncrossError::OrderAuctionMismatch,
        constraint = order.owner == owner.key() @ UncrossError::NotOrderOwner,
    )]
    pub order: Box<Account<'info, Order>>,

    #[account(mut, address = auction.vault_ticker)]
    pub vault_ticker: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, address = auction.vault_quote)]
    pub vault_quote: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: address is the canonical ATA for (owner, ticker_mint, ticker_token_program).
    #[account(mut, address = anchor_spl::associated_token::get_associated_token_address_with_program_id(&owner.key(), &ticker_mint.key(), &ticker_token_program.key()))]
    pub owner_ticker_ata: UncheckedAccount<'info>,
    /// CHECK: address is the canonical ATA for (owner, quote_mint, quote_token_program).
    #[account(mut, address = anchor_spl::associated_token::get_associated_token_address_with_program_id(&owner.key(), &quote_mint.key(), &quote_token_program.key()))]
    pub owner_quote_ata: UncheckedAccount<'info>,

    /// CHECK: address-constrained against auction.ticker_mint; see PlaceOrder.
    #[account(address = auction.ticker_mint)]
    pub ticker_mint: UncheckedAccount<'info>,
    /// CHECK: address-constrained against auction.quote_mint; see PlaceOrder.
    #[account(address = auction.quote_mint)]
    pub quote_mint: UncheckedAccount<'info>,
    #[account(address = auction.ticker_token_program)]
    pub ticker_token_program: Interface<'info, TokenInterface>,
    #[account(address = auction.quote_token_program)]
    pub quote_token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct ComputeClearing<'info> {
    pub caller: Signer<'info>,

    #[account(mut)]
    pub auction: Box<Account<'info, Auction>>,

    /// Any account may be passed here. If it doesn't parse as a fresh Pyth
    /// Price account for this ticker, the clearing algorithm simply proceeds
    /// without an oracle anchor -- see docs/phase0.md Q3. Never trusted blindly.
    /// CHECK: validated best-effort in oracle::read_fresh_price.
    pub pyth_price_feed: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct SettleAccounts<'info> {
    pub caller: Signer<'info>,

    #[account(mut)]
    pub auction: Box<Account<'info, Auction>>,

    #[account(mut, address = auction.vault_ticker)]
    pub vault_ticker: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, address = auction.vault_quote)]
    pub vault_quote: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: address-constrained against auction.ticker_mint; see PlaceOrder.
    #[account(address = auction.ticker_mint)]
    pub ticker_mint: UncheckedAccount<'info>,
    /// CHECK: address-constrained against auction.quote_mint; see PlaceOrder.
    #[account(address = auction.quote_mint)]
    pub quote_mint: UncheckedAccount<'info>,
    #[account(address = auction.ticker_token_program)]
    pub ticker_token_program: Interface<'info, TokenInterface>,
    #[account(address = auction.quote_token_program)]
    pub quote_token_program: Interface<'info, TokenInterface>,
    // remaining_accounts: [order, owner_ticker_ata, owner_quote_ata] per batch entry
}
