use crate::ORACLE_MAX_AGE_SECS;
use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::{
    extension::{scaled_ui_amount::ScaledUiAmountConfig, BaseStateWithExtensions, StateWithExtensions},
    state::Mint,
};

/// Pyth Solana Receiver program. On mainnet, equity feeds (e.g. Equity.US.AAPL/USD)
/// exist only as push-oracle `PriceUpdateV2` accounts owned by this program --
/// there is no classic Pyth price account for them. Verified against the live
/// AAPL feed during Phase 2; see docs/phase2.md.
pub const PYTH_RECEIVER_PROGRAM_ID: Pubkey =
    pubkey!("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");

/// sha256("account:PriceUpdateV2")[..8]
const PRICE_UPDATE_V2_DISCRIMINATOR: [u8; 8] = [0x22, 0xf1, 0x23, 0x63, 0x9d, 0x7e, 0xf4, 0xcd];

/// `VerificationLevel::Full` encodes as the single byte 1. `Partial` carries an
/// extra byte and shifts every later offset, so it is rejected outright --
/// which is also the right policy: only fully Wormhole-verified prices count.
const VERIFICATION_FULL: u8 = 1;

const OFF_VERIFICATION: usize = 40;
const OFF_FEED_ID: usize = 41;
const OFF_PRICE: usize = 73;
const OFF_CONF: usize = 81;
const OFF_EXPO: usize = 89;
const OFF_PUBLISH_TIME: usize = 93;
const MIN_LEN: usize = OFF_PUBLISH_TIME + 8;

/// conf/price cap: a price whose confidence interval is wider than 2% of the
/// price is too uncertain to break a tie with.
pub const MAX_CONF_BPS: u128 = 200;

/// Returns the oracle's price *per share*, scaled to 1e6, only if `account` is
/// a fully-verified PriceUpdateV2 for exactly `expected_feed_id`, published
/// within ORACLE_MAX_AGE_SECS, with conf/price under MAX_CONF_BPS.
///
/// The spec's "status == Trading" gate has no direct equivalent here:
/// PriceUpdateV2 carries no trading-status field, so freshness is the only
/// on-chain signal of a live market. Returns None on anything else, which when
/// the feed has stopped publishing is the expected outcome (docs/phase0.md Q3).
pub fn read_fresh_price(
    account: &AccountInfo,
    expected_feed_id: &[u8; 32],
    clock: &Clock,
) -> Option<u64> {
    if expected_feed_id == &[0u8; 32] {
        return None;
    }
    if account.owner != &PYTH_RECEIVER_PROGRAM_ID {
        return None;
    }
    let data = account.try_borrow_data().ok()?;
    if data.len() < MIN_LEN || data[..8] != PRICE_UPDATE_V2_DISCRIMINATOR {
        return None;
    }
    if data[OFF_VERIFICATION] != VERIFICATION_FULL {
        return None;
    }
    if &data[OFF_FEED_ID..OFF_FEED_ID + 32] != expected_feed_id {
        return None;
    }

    let price = read_i64(&data, OFF_PRICE)?;
    let conf = read_u64(&data, OFF_CONF)?;
    let expo = read_i32(&data, OFF_EXPO)?;
    let publish_time = read_i64(&data, OFF_PUBLISH_TIME)?;

    if price <= 0 {
        return None;
    }
    let age = clock.unix_timestamp.checked_sub(publish_time)?;
    if age < 0 || age as u64 > ORACLE_MAX_AGE_SECS {
        return None;
    }
    if (conf as u128) * 10_000 > (price as u128) * MAX_CONF_BPS {
        return None;
    }

    scale_to_1e6(price, expo)
}

/// Effective scaled-UI multiplier of a Token-2022 mint: `new_multiplier` once
/// its effective timestamp has passed, `multiplier` before that, 1.0 when the
/// mint has no scaledUiAmount extension. For xStocks one raw token is worth `m`
/// real shares, so a per-share oracle price must be multiplied by m before it
/// can be compared with limit prices, which the program quotes per raw token.
pub fn effective_multiplier(mint: &AccountInfo, now: i64) -> Option<f64> {
    let data = mint.try_borrow_data().ok()?;
    let state = StateWithExtensions::<Mint>::unpack(&data[..]).ok()?;
    let Ok(cfg) = state.get_extension::<ScaledUiAmountConfig>() else {
        return Some(1.0);
    };
    let m = if now >= i64::from(cfg.new_multiplier_effective_timestamp) {
        f64::from(cfg.new_multiplier)
    } else {
        f64::from(cfg.multiplier)
    };
    (m.is_finite() && m > 0.0).then_some(m)
}

/// Converts a per-share price (1e6-scaled) to a per-raw-token price.
pub fn per_raw_token(price_per_share: u64, multiplier: f64) -> Option<u64> {
    let v = price_per_share as f64 * multiplier;
    (v.is_finite() && v >= 0.0 && v < u64::MAX as f64).then(|| v.round() as u64)
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

/// A Pyth value is price x 10^expo; in 1e-6 units that is price x 10^(expo + 6).
fn scale_to_1e6(price: i64, expo: i32) -> Option<u64> {
    let price = price as i128;
    let shift = expo + 6;
    let scaled = if shift >= 0 {
        price.checked_mul(10i128.checked_pow(shift as u32)?)?
    } else {
        price.checked_div(10i128.checked_pow((-shift) as u32)?)?
    };
    if scaled < 0 || scaled > u64::MAX as i128 {
        return None;
    }
    Some(scaled as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Real bytes of the mainnet AAPL PriceUpdateV2 account (shard 1,
    /// D9uk39pqZMcnmtPP9WeC8cREUpKZmyXLga9mSQ79SphW) captured 2026-09-15.
    const LIVE_AAPL: &str = "22f123639d7ef4cdb494867230d53f130eac0f2a481323de3989a8a11593389ab65faec97b2949310149f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688b676f701000000003f04000000000000fbffffff219fa96a00000000209fa96a0000000005daf70100000000e0040000000000001ebea91a0000000000";
    const PUBLISH_TIME: i64 = 0x6aa99f21;

    fn aapl_feed_id() -> [u8; 32] {
        let mut id = [0u8; 32];
        id.copy_from_slice(&hex_to_bytes("49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688"));
        id
    }

    fn hex_to_bytes(s: &str) -> Vec<u8> {
        let s = s.trim();
        (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
    }

    fn with_account<F: FnOnce(&AccountInfo)>(data: &mut [u8], owner: &Pubkey, f: F) {
        let key = Pubkey::default();
        let mut lamports = 0u64;
        let ai = AccountInfo::new(&key, false, false, &mut lamports, data, owner, false, 0);
        f(&ai);
    }

    fn clock_at(unix: i64) -> Clock {
        Clock { unix_timestamp: unix, ..Clock::default() }
    }

    #[test]
    fn reads_live_aapl_account() {
        let mut data = hex_to_bytes(LIVE_AAPL);
        with_account(&mut data, &PYTH_RECEIVER_PROGRAM_ID, |ai| {
            // 32994998 x 10^-5 = $329.94998 -> 329_949_980 at 1e6
            assert_eq!(read_fresh_price(ai, &aapl_feed_id(), &clock_at(PUBLISH_TIME + 10)), Some(329_949_980));
        });
    }

    #[test]
    fn scales_every_exponent_the_right_way() {
        assert_eq!(scale_to_1e6(32_994_998, -5), Some(329_949_980)); // Pyth equities
        assert_eq!(scale_to_1e6(11_923_378_000, -8), Some(119_233_780)); // Pyth crypto
        assert_eq!(scale_to_1e6(123, -6), Some(123));
        assert_eq!(scale_to_1e6(5, 0), Some(5_000_000));
    }

    #[test]
    fn rejects_stale_price() {
        let mut data = hex_to_bytes(LIVE_AAPL);
        with_account(&mut data, &PYTH_RECEIVER_PROGRAM_ID, |ai| {
            let stale = PUBLISH_TIME + ORACLE_MAX_AGE_SECS as i64 + 1;
            assert_eq!(read_fresh_price(ai, &aapl_feed_id(), &clock_at(stale)), None);
        });
    }

    #[test]
    fn rejects_wrong_feed() {
        let mut data = hex_to_bytes(LIVE_AAPL);
        let mut other = aapl_feed_id();
        other[0] ^= 0xff;
        with_account(&mut data, &PYTH_RECEIVER_PROGRAM_ID, |ai| {
            assert_eq!(read_fresh_price(ai, &other, &clock_at(PUBLISH_TIME + 10)), None);
        });
    }

    #[test]
    fn rejects_wrong_owner() {
        let mut data = hex_to_bytes(LIVE_AAPL);
        with_account(&mut data, &Pubkey::default(), |ai| {
            assert_eq!(read_fresh_price(ai, &aapl_feed_id(), &clock_at(PUBLISH_TIME + 10)), None);
        });
    }

    #[test]
    fn rejects_no_feed_configured() {
        let mut data = hex_to_bytes(LIVE_AAPL);
        with_account(&mut data, &PYTH_RECEIVER_PROGRAM_ID, |ai| {
            assert_eq!(read_fresh_price(ai, &[0u8; 32], &clock_at(PUBLISH_TIME + 10)), None);
        });
    }

    #[test]
    fn rejects_wide_confidence() {
        let mut data = hex_to_bytes(LIVE_AAPL);
        let wide: u64 = 32_994_998 / 20; // 5% of price
        data[OFF_CONF..OFF_CONF + 8].copy_from_slice(&wide.to_le_bytes());
        with_account(&mut data, &PYTH_RECEIVER_PROGRAM_ID, |ai| {
            assert_eq!(read_fresh_price(ai, &aapl_feed_id(), &clock_at(PUBLISH_TIME + 10)), None);
        });
    }

    #[test]
    fn converts_per_share_to_per_raw_token() {
        assert_eq!(per_raw_token(100_000_000, 1.0), Some(100_000_000));
        assert_eq!(per_raw_token(100_000_000, 1.5), Some(150_000_000));
        assert_eq!(per_raw_token(329_949_980, 5.0), Some(1_649_749_900));
    }
}

#[cfg(test)]
mod multiplier_tests {
    use super::*;

    /// Real bytes of the mainnet AAPLx mint, captured 2026-09-15.
    const AAPLX_MINT_HEX: &str = include_str!("../testdata/aaplx_mint.hex");
    const TOKEN_2022: Pubkey = pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
    // Its scaledUiAmountConfig at capture time, as read via jsonParsed RPC.
    const MULTIPLIER: f64 = 1.0026642075893797;
    const NEW_MULTIPLIER: f64 = 1.0032690125398187;
    const EFFECTIVE_AT: i64 = 1786149000;

    fn with_mint<F: FnOnce(&AccountInfo)>(f: F) {
        let s = AAPLX_MINT_HEX.trim();
        let mut data: Vec<u8> = (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect();
        let key = Pubkey::default();
        let mut lamports = 0u64;
        let ai = AccountInfo::new(&key, false, false, &mut lamports, &mut data, &TOKEN_2022, false, 0);
        f(&ai);
    }

    #[test]
    fn reads_live_aaplx_multiplier_either_side_of_its_scheduled_change() {
        with_mint(|ai| {
            assert_eq!(effective_multiplier(ai, EFFECTIVE_AT - 1), Some(MULTIPLIER));
            assert_eq!(effective_multiplier(ai, EFFECTIVE_AT), Some(NEW_MULTIPLIER));
        });
    }

    #[test]
    fn aapl_oracle_price_converts_to_aaplx_per_token_units() {
        with_mint(|ai| {
            let m = effective_multiplier(ai, EFFECTIVE_AT + 1).unwrap();
            let per_token = per_raw_token(329_949_980, m).unwrap();
            // $329.94998 per share x 1.00326901 shares per token ~ $331.0286
            assert!((331_028_000..331_029_500).contains(&per_token), "{per_token}");
        });
    }
}
