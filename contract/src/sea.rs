//! Parameters and pure math of the sea. Every constant here is fixed at compile time:
//! there is no setter anywhere in the contract. The values come from `sim/tide_sim.py`.

use uint::construct_uint;

construct_uint! {
    pub struct U256(4);
}

/// 1 TIDE = 10^18 units. 1 fish = 1 TIDE.
pub const DECIMALS: u8 = 18;
pub const ONE: u128 = 1_000_000_000_000_000_000;
/// The sea is computed in micro-fish (10^-6 fish) to keep the growth law exact enough and overflow-free.
pub const MICRO: u128 = 1_000_000;
pub const UNITS_PER_MICRO: u128 = ONE / MICRO;

pub const BPS: u128 = 10_000;
pub const PPM: u128 = 1_000_000;

/// Carrying capacity K, Allee threshold A (point of no return), growth rate r.
pub const K_FISH: u128 = 1_000_000;
pub const A_FISH: u128 = 120_000;
pub const R_BPS: i128 = 6_000; // r = 0.6
pub const INITIAL_STOCK_FISH: u128 = 700_000;

/// Whole fleet at full effort takes at most 25% of the stock per season, split by stake.
pub const MAX_TAKE_BPS: u128 = 2_500;
/// Fuel: tokens burned per staked token per season at full effort (0.002).
pub const FUEL_PPM: u128 = 2_000;
/// Quota = 80% of maximum sustainable yield (MSY = 73,155 fish/season at stock 689,000).
pub const QUOTA_FISH: u128 = 58_524;

/// Boats.
pub const MIN_STAKE: u128 = 1_000 * ONE;
pub const BUILD_BURN_BPS: u128 = 100; // 1% of every stake deposit is burned

/// Assembly (Athenian two-stage ostracism).
pub const ASSEMBLY_EVERY: u64 = 3; // the last season of every 3-season cycle is an assembly season
pub const EXILE_SEASONS: u64 = 10;
pub const NAMES_PER_SHARD: usize = 3;
pub const QUORUM_BPS: u128 = 4_000; // a name needs shards from 40% of eligible boats
pub const SHARD_BURN: u128 = ONE; // 1 TIDE burned per name written

/// At most this many missed seasons are processed in one call (anyone can call `tick` to continue).
pub const MAX_CATCHUP: u64 = 40;

pub fn mul_div(a: u128, b: u128, c: u128) -> u128 {
    assert!(c > 0, "division by zero");
    let r = U256::from(a) * U256::from(b) / U256::from(c);
    assert!(r <= U256::from(u128::MAX), "overflow");
    r.as_u128()
}

/// Natural growth per season, in micro-fish. Logistic growth with a strong Allee effect:
/// g(S) = r * S * (1 - S/K) * (S - A) / K. Negative below A: the sea then shrinks even if nobody fishes.
pub fn growth_micro(s: u128) -> i128 {
    let k = (K_FISH * MICRO) as i128;
    let a = (A_FISH * MICRO) as i128;
    let s = s as i128;
    let t = s * (k - s) / k; // <= K/4 ~ 2.5e11
    t * (s - a) / k * R_BPS / BPS as i128
}

/// Stock after one season: remove the catch, then let the sea regrow.
pub fn next_stock_micro(stock: u128, caught: u128) -> u128 {
    let after = stock.saturating_sub(caught);
    let g = growth_micro(after);
    if g >= 0 {
        after + g as u128
    } else {
        after.saturating_sub(g.unsigned_abs())
    }
}

/// Catch (token units) for a boat fishing at `effort_bps` with `stake`, out of a fleet of `fleet` staked
/// tokens, when the season opened with `stock_micro` fish. Computed from the season's opening stock, so the
/// order of transactions inside a season does not matter.
pub fn catch_units(stock_micro: u128, stake: u128, fleet: u128, effort_bps: u128) -> u128 {
    if fleet == 0 {
        return 0;
    }
    let stock_units = stock_micro * UNITS_PER_MICRO;
    let full = mul_div(stock_units, MAX_TAKE_BPS * effort_bps, BPS * BPS);
    mul_div(full, stake, fleet)
}

/// Fuel burned (token units) for fishing at `effort_bps` with `stake`.
pub fn fuel_units(stake: u128, effort_bps: u128) -> u128 {
    mul_div(stake, effort_bps * FUEL_PPM, BPS * PPM)
}

/// This boat's fair share of the season's quota (token units). Exiled stake stays in `fleet`, so an
/// exiled boat's share stays in the sea instead of going to the other boats.
pub fn fair_share_units(stake: u128, fleet: u128) -> u128 {
    if fleet == 0 {
        return 0;
    }
    mul_div(QUOTA_FISH * ONE, stake, fleet)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fish(micro: u128) -> f64 {
        micro as f64 / MICRO as f64
    }

    #[test]
    fn growth_matches_simulation_table() {
        // Values printed by the Python model: g(700k)=73,080, g(500k)=57,000, g(120k)=0, g(50k)=-1,995.
        let g = |f: u128| growth_micro(f * MICRO) as f64 / MICRO as f64;
        assert!((g(700_000) - 73_080.0).abs() < 1.0);
        assert!((g(500_000) - 57_000.0).abs() < 1.0);
        assert_eq!(g(120_000), 0.0);
        assert!((g(50_000) + 1_995.0).abs() < 1.0);
        assert!((g(689_000) - 73_155.0).abs() < 1.0, "MSY");
    }

    #[test]
    fn greedy_full_fleet_needs_eight_seasons_to_cross_allee() {
        // From 700k, whole fleet at full effort (25%/season): ~399k after 3 seasons, below A after 8.
        let mut s = INITIAL_STOCK_FISH * MICRO;
        let mut crossed = None;
        for season in 1..=10u32 {
            let caught = s * MAX_TAKE_BPS / BPS;
            s = next_stock_micro(s, caught);
            if season == 3 {
                assert!((fish(s) - 398_809.0).abs() < 50.0, "after 3: {}", fish(s));
            }
            if crossed.is_none() && s < A_FISH * MICRO {
                crossed = Some(season);
            }
        }
        assert_eq!(crossed, Some(8));
    }

    #[test]
    fn quota_is_eighty_percent_of_msy() {
        let msy = (0..=1000u128)
            .map(|i| growth_micro(K_FISH * MICRO * i / 1000))
            .max()
            .unwrap() as f64
            / MICRO as f64;
        assert!((QUOTA_FISH as f64 - 0.8 * msy).abs() < 1.0);
    }

    #[test]
    fn catch_and_fuel_numbers() {
        // 20 equal boats of 2.5M (50% of 100M staked), stock 700k, full effort:
        let stake = 2_500_000 * ONE;
        let fleet = 50_000_000 * ONE;
        let c = catch_units(700_000 * MICRO, stake, fleet, BPS);
        assert_eq!(c, 8_750 * ONE); // 25% of 700k / 20
        assert_eq!(fuel_units(stake, BPS), 5_000 * ONE); // 0.002 * 2.5M
        let share = fair_share_units(stake, fleet);
        assert_eq!(share, QUOTA_FISH * ONE / 20);
    }
}
