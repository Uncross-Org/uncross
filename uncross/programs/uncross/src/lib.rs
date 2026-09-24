use anchor_lang::prelude::*;
use anchor_spl::associated_token::{get_associated_token_address_with_program_id, AssociatedToken};
use anchor_spl::token_interface::{
    close_account, transfer_checked, CloseAccount, Mint, TokenAccount, TokenInterface, TransferChecked,
};

mod clearing;
mod errors;
mod oracle;
mod state;

use errors::UncrossError;
use state::{
    Auction, Order, OrderSummary, Side, MAX_ORDERS, SETTLE_PATH_CLEAR, SETTLE_PATH_NONE,
    SETTLE_PATH_REFUND, STATUS_CLEARED, STATUS_OPEN, STATUS_SETTLED,
};

declare_id!("Gk9ZUMqPcNuF3PduisUZXBffUP7cCrfnBSCAyTdpjYGP");

/// Program-side ceiling on orders per settle_batch / cancel_and_refund call. It
/// only has to keep a batch inside the compute budget; what actually limits a
/// crank is transaction size. Measured on this instruction without address
/// lookup tables, a batch fits 7 orders when every owner is distinct and ~11
/// when owners repeat (docs/phase2.md).
pub const MAX_BATCH: usize = 12;

/// Freshness window for a Pyth price to count as live. When a feed stops
/// publishing this gate fails and the auction clears on its own book with no
/// oracle anchor. Freshness is not a market-hours signal, though: the AAPL feed
/// was measured still publishing through the close and overnight (docs/pyth.md).
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
        pyth_feed_id: [u8; 32],
    ) -> Result<()> {
        require!(close_slot > open_slot, UncrossError::InvalidWindow);
        require!(freeze_slots < close_slot - open_slot, UncrossError::FreezeTooLong);

        let mut a = ctx.accounts.auction.load_init()?;
        a.ticker_mint = ctx.accounts.ticker_mint.key();
        a.quote_mint = ctx.accounts.quote_mint.key();
        a.ticker_token_program = ctx.accounts.ticker_token_program.key();
        a.quote_token_program = ctx.accounts.quote_token_program.key();
        a.vault_ticker = ctx.accounts.vault_ticker.key();
        a.vault_quote = ctx.accounts.vault_quote.key();
        a.ticker_decimals = ctx.accounts.ticker_mint.decimals;
        a.quote_decimals = ctx.accounts.quote_mint.decimals;
        a.open_slot = open_slot;
        a.close_slot = close_slot;
        a.freeze_slots = freeze_slots;
        a.cadence_slots = cadence_slots;
        a.pyth_feed_id = pyth_feed_id;
        a.protocol_fee_bps = 0; // present but unused, per spec
        a.status = STATUS_OPEN;
        a.settle_path = SETTLE_PATH_NONE;
        a.bump = ctx.bumps.auction;
        a.payer = ctx.accounts.payer.key();
        Ok(())
    }

    pub fn place_order(
        ctx: Context<PlaceOrder>,
        side: Side,
        limit_price: u64,
        quantity: u64,
        order_index: u16,
    ) -> Result<()> {
        let clock = Clock::get()?;
        require!(quantity > 0, UncrossError::ZeroQuantity);
        require!(limit_price > 0, UncrossError::ZeroPrice);

        let (ticker_decimals, quote_decimals) = {
            let a = ctx.accounts.auction.load()?;
            require!(a.status == STATUS_OPEN, UncrossError::AuctionNotOpen);
            require!(
                clock.slot >= a.open_slot && clock.slot < a.close_slot,
                UncrossError::OutsideOpenWindow
            );
            require!((a.order_count as usize) < MAX_ORDERS, UncrossError::OrderBookFull);
            require!(a.order_count == order_index, UncrossError::OrderIndexMismatch);
            (a.ticker_decimals, a.quote_decimals)
        };

        let escrow_amount = match side {
            Side::Buy => clearing::escrow_for_buy(quantity, limit_price, ticker_decimals),
            Side::Sell => quantity,
        };
        require!(escrow_amount > 0, UncrossError::ZeroQuantity);

        let (program, from, mint, to, decimals) = match side {
            Side::Buy => (
                &ctx.accounts.quote_token_program,
                &ctx.accounts.owner_quote_ata,
                &ctx.accounts.quote_mint,
                &ctx.accounts.vault_quote,
                quote_decimals,
            ),
            Side::Sell => (
                &ctx.accounts.ticker_token_program,
                &ctx.accounts.owner_ticker_ata,
                &ctx.accounts.ticker_mint,
                &ctx.accounts.vault_ticker,
                ticker_decimals,
            ),
        };
        transfer_checked(
            CpiContext::new(
                program.to_account_info(),
                TransferChecked {
                    from: from.to_account_info(),
                    mint: mint.to_account_info(),
                    to: to.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            escrow_amount,
            decimals,
        )?;

        let order = &mut ctx.accounts.order;
        order.auction = ctx.accounts.auction.key();
        order.owner = ctx.accounts.owner.key();
        order.order_index = order_index;
        order.side = side;
        order.limit_price = limit_price;
        order.quantity = quantity;
        order.escrow_amount = escrow_amount;
        order.bump = ctx.bumps.order;

        let mut a = ctx.accounts.auction.load_mut()?;
        a.orders[order_index as usize] = OrderSummary {
            limit_price,
            quantity,
            active: 1,
            side: side as u8,
            ..Default::default()
        };
        a.order_count = order_index.checked_add(1).ok_or(UncrossError::MathOverflow)?;
        let (p, v) = clearing::find_clearing_price(&a.orders[..], None);
        a.indicative_price = p;
        a.indicative_volume = v;
        Ok(())
    }

    pub fn cancel_order(ctx: Context<CancelOrder>) -> Result<()> {
        let clock = Clock::get()?;
        let (close_slot, freeze_slots, ticker_mint, open_slot, bump, ticker_decimals, quote_decimals) = {
            let a = ctx.accounts.auction.load()?;
            (a.close_slot, a.freeze_slots, a.ticker_mint, a.open_slot, a.bump, a.ticker_decimals, a.quote_decimals)
        };
        require!(
            clock.slot < close_slot.saturating_sub(freeze_slots),
            UncrossError::PastFreezeWindow
        );
        require!(!ctx.accounts.order.cancelled, UncrossError::AlreadyCancelled);
        require!(!ctx.accounts.order.settled, UncrossError::AlreadySettled);

        let side = ctx.accounts.order.side;
        let escrow_amount = ctx.accounts.order.escrow_amount;
        let order_index = ctx.accounts.order.order_index;

        let open_slot_bytes = open_slot.to_le_bytes();
        let bump_bytes = [bump];
        let seeds: &[&[u8]] = &[b"auction", ticker_mint.as_ref(), &open_slot_bytes, &bump_bytes];
        let auction_ai = ctx.accounts.auction.to_account_info();

        match side {
            Side::Buy => vault_transfer(
                &ctx.accounts.quote_token_program.to_account_info(),
                &ctx.accounts.vault_quote.to_account_info(),
                &ctx.accounts.quote_mint.to_account_info(),
                &ctx.accounts.owner_quote_ata.to_account_info(),
                &auction_ai,
                &[seeds],
                escrow_amount,
                quote_decimals,
            )?,
            Side::Sell => vault_transfer(
                &ctx.accounts.ticker_token_program.to_account_info(),
                &ctx.accounts.vault_ticker.to_account_info(),
                &ctx.accounts.ticker_mint.to_account_info(),
                &ctx.accounts.owner_ticker_ata.to_account_info(),
                &auction_ai,
                &[seeds],
                escrow_amount,
                ticker_decimals,
            )?,
        }

        let order = &mut ctx.accounts.order;
        order.cancelled = true;
        order.refunded = true;
        order.settled = true;

        let mut a = ctx.accounts.auction.load_mut()?;
        a.orders[order_index as usize].cancelled = 1;
        a.orders[order_index as usize].filled_quantity = 0;
        a.settled_count = a.settled_count.saturating_add(1);
        let (p, v) = clearing::find_clearing_price(&a.orders[..], None);
        a.indicative_price = p;
        a.indicative_volume = v;
        Ok(())
    }

    /// Permissionless / crank-callable. Idempotent: a call after the auction is
    /// already Cleared or Settled is a no-op rather than an error.
    pub fn compute_clearing(ctx: Context<ComputeClearing>) -> Result<()> {
        let clock = Clock::get()?;
        let (status, close_slot, feed_id) = {
            let a = ctx.accounts.auction.load()?;
            (a.status, a.close_slot, a.pyth_feed_id)
        };
        if status != STATUS_OPEN {
            return Ok(());
        }
        require!(clock.slot >= close_slot, UncrossError::AuctionNotClosed);

        // Pyth quotes per real share; limit prices are per raw token, and one raw
        // token is worth `m` shares under the mint's scaled-UI multiplier.
        let ticker_mint_ai = ctx.accounts.ticker_mint.to_account_info();
        let reading = oracle::check_price(&ctx.accounts.pyth_price_feed.to_account_info(), &feed_id, &clock);
        let oracle_price = reading.price_per_share.and_then(|per_share| {
            let m = oracle::effective_multiplier(&ticker_mint_ai, clock.unix_timestamp)?;
            oracle::per_raw_token(per_share, m)
        });
        let gate = if reading.price_per_share.is_some() && oracle_price.is_none() {
            oracle::GATE_BAD_MULTIPLIER
        } else {
            reading.outcome
        };

        let mut a = ctx.accounts.auction.load_mut()?;
        a.reference_price_set = oracle_price.is_some() as u8;
        a.reference_price = oracle_price.unwrap_or(0);
        // Recorded so every auction can be audited after the fact: what the
        // gate decided, and how old the price it looked at was.
        a.oracle_gate = gate;
        a.oracle_publish_time = reading.publish_time;

        let (p_star, v_star) = clearing::find_clearing_price(&a.orders[..], oracle_price);
        let ticker_decimals = a.ticker_decimals;
        clearing::assign_fills(&mut a.orders, p_star, v_star);
        clearing::assign_quote_amounts(&mut a.orders, p_star, v_star, ticker_decimals);

        a.clearing_price = p_star;
        a.executable_volume = v_star;
        a.indicative_price = p_star;
        a.indicative_volume = v_star;
        // An empty book, or one where every order was cancelled, has nothing
        // to settle; without this it would sit in Cleared forever.
        a.status = if a.settled_count >= a.order_count { STATUS_SETTLED } else { STATUS_CLEARED };
        Ok(())
    }

    /// Crank-callable, permissionless. Settles a batch of orders using the fills
    /// and quote amounts fixed by compute_clearing. remaining_accounts must be
    /// [order, owner_ticker_ata, owner_quote_ata] repeated once per index.
    pub fn settle_batch<'info>(
        ctx: Context<'_, '_, 'info, 'info, SettleAccounts<'info>>,
        order_indices: Vec<u16>,
    ) -> Result<()> {
        settle_or_refund(ctx, order_indices, SETTLE_PATH_CLEAR)
    }

    /// Failure path: refunds each order's full original escrow, ignoring any
    /// computed fill -- e.g. when settle_batch cannot run because the mint is
    /// paused. Only available before any order has been clear-settled.
    ///
    /// Only when settlement cannot run: the ticker mint is paused, or an
    /// earlier batch already took this path. The second case is the other half
    /// of a pause: buyers' quote escrow can be refunded while the mint is
    /// paused, but sellers' shares only after the issuer resumes it, by which
    /// time the mint is no longer paused. Without this check, whoever sent the
    /// first batch after a cross could pick this path and void every trade.
    pub fn cancel_and_refund<'info>(
        ctx: Context<'_, '_, 'info, 'info, SettleAccounts<'info>>,
        order_indices: Vec<u16>,
    ) -> Result<()> {
        let refund_chosen = ctx.accounts.auction.load()?.settle_path == SETTLE_PATH_REFUND;
        require!(
            refund_chosen || oracle::mint_paused(&ctx.accounts.ticker_mint.to_account_info()),
            UncrossError::RefundNotAllowed
        );
        settle_or_refund(ctx, order_indices, SETTLE_PATH_REFUND)
    }

    /// Permissionless. Returns the rent of a finished auction and its two
    /// vaults to whoever paid it. Refuses anything that could still owe a user
    /// money: the auction must be fully settled and both vaults exactly empty.
    /// Leaking rent is recoverable; stranding escrow is not.
    pub fn close_auction(ctx: Context<CloseAuction>) -> Result<()> {
        let (ticker_mint, open_slot, bump) = {
            let a = ctx.accounts.auction.load()?;
            require!(a.payer != Pubkey::default(), UncrossError::UnknownRentPayer);
            require!(a.status == STATUS_SETTLED, UncrossError::AuctionNotSettled);
            require!(a.settled_count >= a.order_count, UncrossError::AuctionNotSettled);
            (a.ticker_mint, a.open_slot, a.bump)
        };
        require!(
            ctx.accounts.vault_ticker.amount == 0 && ctx.accounts.vault_quote.amount == 0,
            UncrossError::VaultNotEmpty
        );

        let open_slot_bytes = open_slot.to_le_bytes();
        let bump_bytes = [bump];
        let seeds: &[&[u8]] = &[b"auction", ticker_mint.as_ref(), &open_slot_bytes, &bump_bytes];
        let signer = [seeds];

        for (vault, program) in [
            (ctx.accounts.vault_ticker.to_account_info(), ctx.accounts.ticker_token_program.to_account_info()),
            (ctx.accounts.vault_quote.to_account_info(), ctx.accounts.quote_token_program.to_account_info()),
        ] {
            close_account(CpiContext::new_with_signer(
                program,
                CloseAccount {
                    account: vault,
                    destination: ctx.accounts.rent_recipient.to_account_info(),
                    authority: ctx.accounts.auction.to_account_info(),
                },
                &signer,
            ))?;
        }
        // The auction account itself is closed to rent_recipient by the
        // `close` constraint once this returns.
        Ok(())
    }
}

#[allow(clippy::too_many_arguments)]
fn vault_transfer<'info>(
    token_program: &AccountInfo<'info>,
    from: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    signer_seeds: &[&[&[u8]]],
    amount: u64,
    decimals: u8,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    transfer_checked(
        CpiContext::new_with_signer(
            token_program.clone(),
            TransferChecked {
                from: from.clone(),
                mint: mint.clone(),
                to: to.clone(),
                authority: authority.clone(),
            },
            signer_seeds,
        ),
        amount,
        decimals,
    )
}

fn settle_or_refund<'info>(
    ctx: Context<'_, '_, 'info, 'info, SettleAccounts<'info>>,
    order_indices: Vec<u16>,
    path: u8,
) -> Result<()> {
    require!(
        !order_indices.is_empty() && order_indices.len() <= MAX_BATCH,
        UncrossError::BatchTooLarge
    );
    require!(
        ctx.remaining_accounts.len() == order_indices.len() * 3,
        UncrossError::OrderIndexOutOfRange
    );

    let (ticker_mint, quote_mint, open_slot, bump, ticker_decimals, quote_decimals) = {
        let mut a = ctx.accounts.auction.load_mut()?;
        require!(a.status != STATUS_OPEN, UncrossError::NotYetCleared);
        require!(
            a.settle_path == SETTLE_PATH_NONE || a.settle_path == path,
            UncrossError::SettlementPathLocked
        );
        a.settle_path = path;
        (a.ticker_mint, a.quote_mint, a.open_slot, a.bump, a.ticker_decimals, a.quote_decimals)
    };

    let auction_key = ctx.accounts.auction.key();
    let ticker_program_ai = ctx.accounts.ticker_token_program.to_account_info();
    let quote_program_ai = ctx.accounts.quote_token_program.to_account_info();
    let ticker_mint_ai = ctx.accounts.ticker_mint.to_account_info();
    let quote_mint_ai = ctx.accounts.quote_mint.to_account_info();
    let vault_ticker_ai = ctx.accounts.vault_ticker.to_account_info();
    let vault_quote_ai = ctx.accounts.vault_quote.to_account_info();
    let auction_ai = ctx.accounts.auction.to_account_info();

    let open_slot_bytes = open_slot.to_le_bytes();
    let bump_bytes = [bump];
    let seeds: &[&[u8]] = &[b"auction", ticker_mint.as_ref(), &open_slot_bytes, &bump_bytes];
    let signer = [seeds];

    let mut newly_settled: u16 = 0;
    for (i, &order_index) in order_indices.iter().enumerate() {
        require!((order_index as usize) < MAX_ORDERS, UncrossError::OrderIndexOutOfRange);

        let order_ai = &ctx.remaining_accounts[i * 3];
        let owner_ticker_ata = &ctx.remaining_accounts[i * 3 + 1];
        let owner_quote_ata = &ctx.remaining_accounts[i * 3 + 2];

        let (expected_order, _) = Pubkey::find_program_address(
            &[b"order", auction_key.as_ref(), &order_index.to_le_bytes()],
            ctx.program_id,
        );
        require_keys_eq!(order_ai.key(), expected_order, UncrossError::OrderIndexOutOfRange);

        let mut order: Account<Order> = Account::try_from(order_ai)?;
        require!(order.auction == auction_key, UncrossError::OrderAuctionMismatch);
        if order.settled {
            continue;
        }

        require_keys_eq!(
            owner_ticker_ata.key(),
            get_associated_token_address_with_program_id(&order.owner, &ticker_mint, ticker_program_ai.key),
            UncrossError::WrongMint
        );
        require_keys_eq!(
            owner_quote_ata.key(),
            get_associated_token_address_with_program_id(&order.owner, &quote_mint, quote_program_ai.key),
            UncrossError::WrongMint
        );

        let (filled, quote_amount) = {
            let a = ctx.accounts.auction.load()?;
            let s = &a.orders[order_index as usize];
            (s.filled_quantity, s.quote_amount)
        };

        let ticker_out = |to: &AccountInfo<'info>, amount: u64| {
            vault_transfer(&ticker_program_ai, &vault_ticker_ai, &ticker_mint_ai, to, &auction_ai, &signer, amount, ticker_decimals)
        };
        let quote_out = |to: &AccountInfo<'info>, amount: u64| {
            vault_transfer(&quote_program_ai, &vault_quote_ai, &quote_mint_ai, to, &auction_ai, &signer, amount, quote_decimals)
        };

        match (path, order.side) {
            (SETTLE_PATH_CLEAR, Side::Buy) => {
                ticker_out(owner_ticker_ata, filled)?;
                quote_out(owner_quote_ata, order.escrow_amount.saturating_sub(quote_amount))?;
            }
            (SETTLE_PATH_CLEAR, Side::Sell) => {
                quote_out(owner_quote_ata, quote_amount)?;
                ticker_out(owner_ticker_ata, order.quantity.saturating_sub(filled))?;
            }
            (_, Side::Buy) => quote_out(owner_quote_ata, order.escrow_amount)?,
            (_, Side::Sell) => ticker_out(owner_ticker_ata, order.escrow_amount)?,
        }

        order.filled_quantity = if path == SETTLE_PATH_CLEAR { filled } else { 0 };
        order.refunded = path == SETTLE_PATH_REFUND;
        order.settled = true;
        order.exit(ctx.program_id)?;
        newly_settled += 1;
    }

    let mut a = ctx.accounts.auction.load_mut()?;
    a.settled_count = a.settled_count.saturating_add(newly_settled);
    if a.settled_count >= a.order_count {
        a.status = STATUS_SETTLED;
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
    pub auction: AccountLoader<'info, Auction>,

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
#[instruction(side: Side, limit_price: u64, quantity: u64, order_index: u16)]
pub struct PlaceOrder<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(mut)]
    pub auction: AccountLoader<'info, Auction>,

    #[account(
        init,
        payer = owner,
        space = Order::SIZE,
        seeds = [b"order", auction.key().as_ref(), order_index.to_le_bytes().as_ref()],
        bump,
    )]
    pub order: Box<Account<'info, Order>>,

    /// CHECK: must be the auction's own ticker vault.
    #[account(mut, address = auction.load()?.vault_ticker)]
    pub vault_ticker: UncheckedAccount<'info>,
    /// CHECK: must be the auction's own quote vault.
    #[account(mut, address = auction.load()?.vault_quote)]
    pub vault_quote: UncheckedAccount<'info>,

    /// Must already exist. Left unchecked (address-derived, not deserialized as
    /// a typed Token-2022 account) to keep this struct's BPF stack frame small.
    /// CHECK: canonical ATA for (owner, ticker_mint, ticker_token_program).
    #[account(mut, address = get_associated_token_address_with_program_id(&owner.key(), &ticker_mint.key(), &ticker_token_program.key()))]
    pub owner_ticker_ata: UncheckedAccount<'info>,
    /// CHECK: canonical ATA for (owner, quote_mint, quote_token_program).
    #[account(mut, address = get_associated_token_address_with_program_id(&owner.key(), &quote_mint.key(), &quote_token_program.key()))]
    pub owner_quote_ata: UncheckedAccount<'info>,

    /// CHECK: must be the auction's ticker mint; decimals come from the auction.
    #[account(address = auction.load()?.ticker_mint)]
    pub ticker_mint: UncheckedAccount<'info>,
    /// CHECK: must be the auction's quote mint.
    #[account(address = auction.load()?.quote_mint)]
    pub quote_mint: UncheckedAccount<'info>,
    #[account(address = auction.load()?.ticker_token_program)]
    pub ticker_token_program: Interface<'info, TokenInterface>,
    #[account(address = auction.load()?.quote_token_program)]
    pub quote_token_program: Interface<'info, TokenInterface>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelOrder<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(mut)]
    pub auction: AccountLoader<'info, Auction>,

    #[account(
        mut,
        seeds = [b"order", auction.key().as_ref(), order.order_index.to_le_bytes().as_ref()],
        bump = order.bump,
        constraint = order.auction == auction.key() @ UncrossError::OrderAuctionMismatch,
        constraint = order.owner == owner.key() @ UncrossError::NotOrderOwner,
    )]
    pub order: Box<Account<'info, Order>>,

    /// CHECK: must be the auction's own ticker vault.
    #[account(mut, address = auction.load()?.vault_ticker)]
    pub vault_ticker: UncheckedAccount<'info>,
    /// CHECK: must be the auction's own quote vault.
    #[account(mut, address = auction.load()?.vault_quote)]
    pub vault_quote: UncheckedAccount<'info>,

    /// CHECK: canonical ATA for (owner, ticker_mint, ticker_token_program).
    #[account(mut, address = get_associated_token_address_with_program_id(&owner.key(), &ticker_mint.key(), &ticker_token_program.key()))]
    pub owner_ticker_ata: UncheckedAccount<'info>,
    /// CHECK: canonical ATA for (owner, quote_mint, quote_token_program).
    #[account(mut, address = get_associated_token_address_with_program_id(&owner.key(), &quote_mint.key(), &quote_token_program.key()))]
    pub owner_quote_ata: UncheckedAccount<'info>,

    /// CHECK: must be the auction's ticker mint.
    #[account(address = auction.load()?.ticker_mint)]
    pub ticker_mint: UncheckedAccount<'info>,
    /// CHECK: must be the auction's quote mint.
    #[account(address = auction.load()?.quote_mint)]
    pub quote_mint: UncheckedAccount<'info>,
    #[account(address = auction.load()?.ticker_token_program)]
    pub ticker_token_program: Interface<'info, TokenInterface>,
    #[account(address = auction.load()?.quote_token_program)]
    pub quote_token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct ComputeClearing<'info> {
    pub caller: Signer<'info>,

    #[account(mut)]
    pub auction: AccountLoader<'info, Auction>,

    /// CHECK: must be the auction's ticker mint; read only for its scaled-UI multiplier.
    #[account(address = auction.load()?.ticker_mint)]
    pub ticker_mint: UncheckedAccount<'info>,

    /// Pyth PriceUpdateV2 account for this auction's feed. Any account may be
    /// passed; oracle::read_fresh_price checks owner, feed id, verification
    /// level, freshness and confidence, and anything that fails simply means
    /// "no oracle anchor" for this cross.
    /// CHECK: validated in oracle::read_fresh_price, never trusted blindly.
    pub pyth_price_feed: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct SettleAccounts<'info> {
    pub caller: Signer<'info>,

    #[account(mut)]
    pub auction: AccountLoader<'info, Auction>,

    /// CHECK: must be the auction's own ticker vault.
    #[account(mut, address = auction.load()?.vault_ticker)]
    pub vault_ticker: UncheckedAccount<'info>,
    /// CHECK: must be the auction's own quote vault.
    #[account(mut, address = auction.load()?.vault_quote)]
    pub vault_quote: UncheckedAccount<'info>,

    /// CHECK: must be the auction's ticker mint.
    #[account(address = auction.load()?.ticker_mint)]
    pub ticker_mint: UncheckedAccount<'info>,
    /// CHECK: must be the auction's quote mint.
    #[account(address = auction.load()?.quote_mint)]
    pub quote_mint: UncheckedAccount<'info>,
    #[account(address = auction.load()?.ticker_token_program)]
    pub ticker_token_program: Interface<'info, TokenInterface>,
    #[account(address = auction.load()?.quote_token_program)]
    pub quote_token_program: Interface<'info, TokenInterface>,
    // remaining_accounts: [order, owner_ticker_ata, owner_quote_ata] per batch entry
}

#[derive(Accounts)]
pub struct CloseAuction<'info> {
    pub caller: Signer<'info>,

    #[account(mut, close = rent_recipient)]
    pub auction: AccountLoader<'info, Auction>,

    /// CHECK: only ever credited; must be the account recorded as having paid.
    #[account(mut, address = auction.load()?.payer @ UncrossError::WrongRentRecipient)]
    pub rent_recipient: UncheckedAccount<'info>,

    #[account(mut, address = auction.load()?.vault_ticker)]
    pub vault_ticker: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, address = auction.load()?.vault_quote)]
    pub vault_quote: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(address = auction.load()?.ticker_token_program)]
    pub ticker_token_program: Interface<'info, TokenInterface>,
    #[account(address = auction.load()?.quote_token_program)]
    pub quote_token_program: Interface<'info, TokenInterface>,
}
