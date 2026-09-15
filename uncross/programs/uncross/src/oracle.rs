use crate::ORACLE_MAX_AGE_SECS;
use anchor_lang::prelude::*;

/// Owner program of Pyth's classic on-chain Price account on Solana mainnet.
/// Confirmed live against the SOL/USD feed (H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG)
/// during docs/phase0.md / Phase 1 research.
pub const PYTH_PROGRAM_ID: Pubkey = pubkey!("FsJ3A3u2vn5cTVofAjvy6y5kwABJAqYWpe4975bi2epH");

const PYTH_MAGIC: u32 = 0xa1b2c3d4;
const AGG_OFFSET: usize = 208;
const MIN_ACCOUNT_LEN: usize = AGG_OFFSET + 32;

/// price_type/status as laid out in Pyth's classic PriceInfo struct.
const STATUS_TRADING: u32 = 1;

/// Reads a Pyth classic on-chain Price account by hand -- avoids pulling in the
/// pyth-sdk-solana crate, whose pinned borsh version conflicts with the rest of
/// this program's (much newer) solana-program dependency tree. Layout offsets
/// were verified against a live mainnet account, not assumed from docs; see
/// docs/phase1.md.
///
/// Returns a price scaled to 1e6 (matching the fixed-point convention used for
/// limit_price / clearing_price elsewhere) only if the account parses, is
/// currently `status == Trading`, and its aggregate publish slot maps to a
/// timestamp within ORACLE_MAX_AGE_SECS. Otherwise returns None -- which is the
/// expected, normal outcome outside US market hours per docs/phase0.md Q3, not
/// an error condition.
pub fn read_fresh_price(account: &UncheckedAccount, clock: &Clock) -> Option<u64> {
    if account.owner != &PYTH_PROGRAM_ID {
        return None;
    }
    let data = account.try_borrow_data().ok()?;
    if data.len() < MIN_ACCOUNT_LEN {
        return None;
    }

    let magic = read_u32(&data, 0)?;
    if magic != PYTH_MAGIC {
        return None;
    }
    let expo = read_i32(&data, 20)?;

    let price = read_i64(&data, AGG_OFFSET)?;
    let status = read_u32(&data, AGG_OFFSET + 16)?;
    let pub_slot = read_u64(&data, AGG_OFFSET + 24)?;

    if status != STATUS_TRADING || price <= 0 {
        return None;
    }

    // Freshness is judged on slot distance rather than the account's embedded
    // timestamp (which needs a slot->unix_timestamp lookup we don't have
    // cheaply on-chain): ~2 slots/sec on Solana, so ORACLE_MAX_AGE_SECS * 2
    // slots is our staleness budget.
    let clock_slot = clock.slot;
    let max_slot_age = ORACLE_MAX_AGE_SECS.saturating_mul(2);
    if clock_slot.saturating_sub(pub_slot) > max_slot_age {
        return None;
    }

    scale_to_1e6(price, expo)
}

fn read_u32(data: &[u8], offset: usize) -> Option<u32> {
    data.get(offset..offset + 4)
        .map(|b| u32::from_le_bytes(b.try_into().unwrap()))
}

fn read_i32(data: &[u8], offset: usize) -> Option<i32> {
    data.get(offset..offset + 4)
        .map(|b| i32::from_le_bytes(b.try_into().unwrap()))
}

fn read_i64(data: &[u8], offset: usize) -> Option<i64> {
    data.get(offset..offset + 8)
        .map(|b| i64::from_le_bytes(b.try_into().unwrap()))
}

fn read_u64(data: &[u8], offset: usize) -> Option<u64> {
    data.get(offset..offset + 8)
        .map(|b| u64::from_le_bytes(b.try_into().unwrap()))
}

fn scale_to_1e6(price: i64, expo: i32) -> Option<u64> {
    let price = price as i128;
    let target_expo: i32 = -6;
    let diff = target_expo - expo;
    let scaled = if diff >= 0 {
        price.checked_mul(10i128.checked_pow(diff as u32)?)?
    } else {
        price.checked_div(10i128.checked_pow((-diff) as u32)?)?
    };
    if scaled < 0 || scaled > u64::MAX as i128 {
        return None;
    }
    Some(scaled as u64)
}
