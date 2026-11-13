use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, NearToken};

const SEASON_SEC: u64 = 60;
const NS: u64 = 1_000_000_000;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

/// Put the VM at `season` (+ `frac` of the season, 0.0..1.0), called by `who`.
fn at(who: &str, season: u64, frac: f64) {
    let ts = season * SEASON_SEC * NS + (frac * (SEASON_SEC * NS) as f64) as u64;
    testing_env!(VMContextBuilder::new()
        .current_account_id(acc("tide.testnet"))
        .predecessor_account_id(acc(who))
        .block_timestamp(ts)
        .attached_deposit(NearToken::from_yoctonear(1))
        .build());
}

const BOATS: [&str; 5] = [
    "ana.testnet",
    "ben.testnet",
    "cy.testnet",
    "dee.testnet",
    "greedy.testnet",
];

/// Five holders with 10M TIDE each; each stakes 5M in season 0 (4.95M after the 1% build burn).
fn setup() -> Tide {
    at("deployer.testnet", 0, 0.0);
    let genesis = BOATS
        .iter()
        .map(|b| (acc(b), U128(10_000_000 * ONE)))
        .collect();
    let mut t = Tide::new(genesis, SEASON_SEC, U128(0));
    for b in BOATS {
        at(b, 0, 0.1);
        t.stake(U128(5_000_000 * ONE));
    }
    t
}

fn bal(t: &Tide, who: &str) -> u128 {
    t.ft_balance_of(acc(who)).0
}

#[test]
fn genesis_and_build_burn() {
    let t = setup();
    // 50M minted at genesis, 5 x 50k burned building boats.
    assert_eq!(t.ft_total_supply().0, 50_000_000 * ONE - 250_000 * ONE);
    assert_eq!(bal(&t, "ana.testnet"), 5_000_000 * ONE);
    let boat = t.get_boat(acc("ana.testnet")).unwrap();
    assert_eq!(boat.boat.stake.0, 4_950_000 * ONE);
    assert!(
        !boat.can_fish_now,
        "a boat built this season cannot fish yet"
    );
    assert_eq!(t.get_params()["admin"], serde_json::Value::Null);
}

#[test]
#[should_panic(expected = "fish next season")]
fn new_boat_cannot_fish_in_its_build_season() {
    let mut t = setup();
    at("ana.testnet", 0, 0.5);
    t.fish(10_000);
}

#[test]
fn fair_fishing_mints_catch_and_burns_fuel() {
    let mut t = setup();
    at("ana.testnet", 1, 0.1);
    let supply_before = t.ft_total_supply().0;
    let share = t.get_boat(acc("ana.testnet")).unwrap().fair_share.0;
    // Fishing at exactly the fair share: effort = share / full catch.
    let full = t.get_boat(acc("ana.testnet")).unwrap().full_effort_catch.0;
    let opening_stock = t.get_sea().stock_fish.0;
    assert_eq!(opening_stock, 773_080);
    let expected_full = opening_stock * ONE * 2_500 / 10_000 / 5;
    assert!(full.abs_diff(expected_full) <= ONE);
    let effort = (share * 10_000 / full) as u16; // ~3344 bps
    let c = t.fish(effort).0;
    assert!(c <= share);
    let fuel = fuel_units(4_950_000 * ONE, effort as u128);
    assert_eq!(t.ft_total_supply().0, supply_before + c - fuel);
    assert!(
        t.get_indictments(0).is_empty(),
        "fair fishing is not indicted"
    );
}

#[test]
fn order_inside_a_season_does_not_matter() {
    let mut t = setup();
    at("ana.testnet", 1, 0.1);
    let a = t.fish(5_000).0;
    at("ben.testnet", 1, 0.9);
    let b = t.fish(5_000).0;
    assert_eq!(a, b, "both catches use the season's opening stock");
}

#[test]
fn overfishing_is_indicted_and_blocks_unstaking() {
    let mut t = setup();
    at("greedy.testnet", 1, 0.1);
    t.fish(10_000); // 35,000 vs a fair share of ~11,705
    let list = t.get_indictments(0);
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].0, acc("greedy.testnet"));
    assert!(list[0].1 .0 > 23_000 * ONE);
    at("greedy.testnet", 2, 0.1);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| t.unstake(U128(ONE))));
    assert!(
        r.is_err(),
        "indicted boats cannot unstake before the assembly closes"
    );
}

/// The full ritual: greedy overfishes in season 1; season 2 is the assembly; greedy is exiled from season 3.
fn ostracise_greedy(t: &mut Tide) {
    at("greedy.testnet", 1, 0.1);
    t.fish(10_000);
    for b in &BOATS[..4] {
        at(b, 2, 0.1);
        t.vote_hold(true);
    }
    at("greedy.testnet", 2, 0.2);
    t.vote_hold(false);
    for b in &BOATS[..3] {
        at(b, 2, 0.6);
        t.write_shard(vec![acc("greedy.testnet")]);
    }
    at("ana.testnet", 3, 0.1);
    t.tick();
}

#[test]
fn assembly_exiles_the_overfisher_and_keeps_its_tokens() {
    let mut t = setup();
    let before = bal(&t, "greedy.testnet");
    ostracise_greedy(&mut t);
    let res = t.get_assembly()["last_result"].clone();
    assert_eq!(res["held"], true);
    assert_eq!(res["exiled"][0], "greedy.testnet");
    assert_eq!(
        t.get_exiles(),
        vec![(acc("greedy.testnet"), 3 + EXILE_SEASONS)]
    );
    assert!(
        bal(&t, "greedy.testnet") > before,
        "exile never confiscates: the catch is still there"
    );
    assert_eq!(t.get_sea().voter_count, 4, "exiled boats do not vote");
}

#[test]
#[should_panic(expected = "EXILED until season 13")]
fn exiled_cannot_transfer() {
    let mut t = setup();
    ostracise_greedy(&mut t);
    at("greedy.testnet", 4, 0.1);
    t.ft_transfer(acc("ana.testnet"), U128(ONE), None);
}

#[test]
#[should_panic(expected = "EXILED")]
fn exiled_cannot_fish() {
    let mut t = setup();
    ostracise_greedy(&mut t);
    at("greedy.testnet", 4, 0.1);
    t.fish(100);
}

#[test]
fn exile_ends_after_ten_seasons() {
    let mut t = setup();
    ostracise_greedy(&mut t);
    at("greedy.testnet", 13, 0.1);
    t.tick();
    assert!(t.get_exiles().is_empty());
    assert_eq!(t.get_sea().voter_count, 5);
    t.fish(100); // allowed again
    t.ft_transfer(acc("ana.testnet"), U128(ONE), None);
}

#[test]
fn exiled_share_stays_in_the_sea() {
    let mut t = setup();
    ostracise_greedy(&mut t);
    // Fleet snapshot still includes greedy's stake, so the others' fair share does not grow.
    at("ana.testnet", 4, 0.1);
    let share = t.get_boat(acc("ana.testnet")).unwrap().fair_share.0;
    assert_eq!(share, QUOTA_FISH * ONE / 5);
}

#[test]
fn minority_faction_cannot_hold_an_ostracism() {
    let mut t = setup();
    // Two boats (40%) want to exile an honest rival; the other three vote no.
    for b in &BOATS[3..] {
        at(b, 2, 0.1);
        t.vote_hold(true);
    }
    for b in &BOATS[..3] {
        at(b, 2, 0.2);
        t.vote_hold(false);
    }
    at("dee.testnet", 2, 0.6);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        t.write_shard(vec![acc("ana.testnet")])
    }));
    assert!(r.is_err(), "stage 2 is closed when stage 1 fails");
    at("ana.testnet", 3, 0.1);
    t.tick();
    assert_eq!(t.get_assembly()["last_result"]["held"], false);
    assert!(t.get_exiles().is_empty());
}

#[test]
#[should_panic(expected = "only boats can be ostracised")]
fn cannot_ostracise_a_non_boat() {
    let mut t = setup();
    for b in BOATS {
        at(b, 2, 0.1);
        t.vote_hold(true);
    }
    at("ana.testnet", 2, 0.6);
    t.write_shard(vec![acc("ref-finance.testnet")]);
}

#[test]
fn greedy_fleet_kills_the_sea_in_eight_seasons() {
    let mut t = setup();
    let mut died = None;
    for season in 1..=12u64 {
        for b in BOATS {
            at(b, season, 0.1);
            if !t.get_boat(acc(b)).unwrap().can_fish_now {
                break;
            }
            t.fish(10_000);
        }
        if died.is_none() {
            at("ana.testnet", season + 1, 0.0);
            t.tick();
            died = t.get_sea().died_season;
        }
    }
    // Season 0 is unfished (boats built that season cannot fish), so the sea first grows 700k -> 773k;
    // then 8 seasons of full-fleet fishing (1..=8) push it below 120k at the close of season 9.
    assert_eq!(died, Some(10));
    at("ana.testnet", 13, 0.1);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| t.fish(100)));
    assert!(r.is_err(), "THE SEA IS DEAD");
}

#[test]
fn fair_fleet_keeps_the_sea_alive() {
    let mut t = setup();
    for season in 1..=60u64 {
        for b in BOATS {
            at(b, season, 0.1);
            let v = t.get_boat(acc(b)).unwrap();
            let effort =
                ((v.fair_share.0 * 10_000) / v.full_effort_catch.0.max(1)).min(10_000) as u16;
            if effort > 0 {
                t.fish(effort);
            }
        }
    }
    at("ana.testnet", 61, 0.1);
    t.tick();
    let sea = t.get_sea();
    assert!(!sea.dead);
    assert!(
        sea.stock_fish.0 > 689_000,
        "stock settles above the MSY level: {}",
        sea.stock_fish.0
    );
}

#[test]
fn lazy_catch_up_after_a_quiet_period() {
    let mut t = setup();
    at("ana.testnet", 30, 0.1);
    t.tick();
    let sea = t.get_sea();
    assert_eq!(sea.season, 30);
    assert!(sea.synced);
    assert!(
        sea.stock_fish.0 > 700_000,
        "the unfished sea regrows toward K"
    );
}

fn many_boats() -> (Tide, Vec<String>) {
    at("deployer.testnet", 0, 0.0);
    let names: Vec<String> = (0..25).map(|i| format!("boat{}.testnet", i)).collect();
    let genesis = names
        .iter()
        .map(|name| (acc(name), U128(10_000_000 * ONE)))
        .collect();
    let mut t = Tide::new(genesis, SEASON_SEC, U128(0));
    for name in &names {
        at(name, 0, 0.1);
        t.stake(U128(5_000_000 * ONE));
    }
    (t, names)
}

fn drive_fleet_to_wreck(t: &mut Tide, names: &[String]) {
    for season in 1..=9u64 {
        for name in names {
            at(name, season, 0.1);
            if t.get_sea().phase == Phase::Wrecked {
                return;
            }
            t.fish(10_000);
        }
        at(&names[0], season + 1, 0.0);
        t.tick();
        if t.get_sea().phase == Phase::Wrecked {
            return;
        }
    }
}

#[test]
fn crossing_the_line_wrecks_every_boat_and_burns_half_the_stake() {
    let (mut t, names) = many_boats();
    drive_fleet_to_wreck(&mut t, &names);
    assert_eq!(t.get_sea().phase, Phase::Wrecked);
    let supply_before_last_batch = t.ft_total_supply().0;
    t.settle_wreck();
    let expected_last_batch = 5 * (4_950_000 * ONE) * WRECK_BURN_BPS / BPS;
    assert_eq!(
        supply_before_last_batch - t.ft_total_supply().0,
        expected_last_batch
    );
    assert_eq!(
        t.reckoning_history[0].burned_total.0,
        25 * expected_last_batch / 5
    );
    for name in names {
        assert_eq!(t.get_boat(acc(&name)).unwrap().boat.stake.0, 0);
    }
    assert_eq!(t.get_sea().staked_total.0, 0);
    assert_eq!(t.get_reckoning()["phase"], "Wrecked");
}

#[test]
fn settle_wreck_is_bounded_and_idempotent() {
    let (mut t, names) = many_boats();
    drive_fleet_to_wreck(&mut t, &names);
    assert!(t.wreck_cursor > 0 && t.wreck_cursor <= WRECK_BATCH as u32);
    t.settle_wreck();
    assert!(!t.wreck_pending);
    let supply = t.ft_total_supply().0;
    t.settle_wreck();
    assert_eq!(t.ft_total_supply().0, supply);
}

#[test]
fn funded_reseed_decays_capacity_and_enters_recovery() {
    let mut t = setup();
    let names: Vec<String> = BOATS.iter().map(|name| name.to_string()).collect();
    drive_fleet_to_wreck(&mut t, &names);
    at("ana.testnet", 10, 0.1);
    t.contribute_reseed(U128(RESEED_COST));
    let sea = t.get_sea();
    assert_eq!(sea.generation, 1);
    assert_eq!(sea.phase, Phase::Recovering);
    assert_eq!(sea.carrying_capacity.0, K_FISH * K_DECAY_BPS / BPS);
    assert_eq!(
        sea.stock_fish.0,
        sea.carrying_capacity.0 * RESEED_HEALTHY_BPS / BPS
    );
    assert_eq!(
        sea.quota_per_season.0,
        quota_fish_for_capacity(sea.carrying_capacity.0)
    );
    assert_eq!(t.get_reckoning()["contributors"], serde_json::json!([]));
}

#[test]
fn deadline_reseed_uses_fallback_and_recovery_tax_takes_full_fish() {
    let mut t = setup();
    let names: Vec<String> = BOATS.iter().map(|name| name.to_string()).collect();
    drive_fleet_to_wreck(&mut t, &names);
    at("ana.testnet", 70, 0.1);
    t.tick();
    assert_eq!(t.get_sea().phase, Phase::Recovering);
    assert_eq!(t.get_sea().stock_fish.0, 240_000);

    at("ana.testnet", 70, 0.2);
    t.stake(U128(5_000_000 * ONE));
    at("ana.testnet", 71, 0.1);
    let opening = t.get_sea().stock_fish.0 * MICRO;
    let full = t.get_boat(acc("ana.testnet")).unwrap().full_effort_catch.0;
    let supply_before = t.ft_total_supply().0;
    let minted = t.fish(10_000).0;
    at("ana.testnet", 72, 0.0);
    t.tick();
    let taken = full;
    assert_eq!(minted + t.recovery_burned, taken);
    assert_eq!(t.recovery_burned, taken * RECOVERY_TAX_BPS / BPS);
    assert_eq!(
        t.get_sea().stock_fish.0,
        next_stock_micro_with_capacity(opening, taken / UNITS_PER_MICRO, 800_000) / MICRO
    );
    assert_eq!(
        t.ft_total_supply().0 - supply_before,
        minted - fuel_units(4_950_000 * ONE, BPS)
    );
}

#[test]
fn capacity_decay_eventually_loses_the_sea_forever() {
    let mut capacity = K_FISH;
    for _ in 0..10 {
        capacity = capacity * K_DECAY_BPS / BPS;
    }
    assert!(capacity <= A_FISH);
    assert!(capacity > A_FISH * K_DECAY_BPS / BPS);
}

#[test]
fn wreck_loss_beats_the_raiders_final_grab() {
    let mut raider = setup();
    let starting_stake = raider.get_boat(acc("greedy.testnet")).unwrap().boat.stake.0;
    let names: Vec<String> = BOATS.iter().map(|name| name.to_string()).collect();
    drive_fleet_to_wreck(&mut raider, &names);
    assert_eq!(raider.get_sea().phase, Phase::Wrecked);

    // Compare the largest one-season grab with the wreck loss, conservatively charging
    // the fair-share boat a full-effort fuel bill.
    let fleet = 5 * starting_stake;
    let final_grab = catch_units(773_080 * MICRO, starting_stake, fleet, BPS);
    let wreck_loss = starting_stake * WRECK_BURN_BPS / BPS;
    let raider_net = final_grab.saturating_sub(fuel_units(starting_stake, BPS) + wreck_loss);
    let fair_net = fair_share_for_capacity_units(starting_stake, fleet, K_FISH)
        .saturating_sub(fuel_units(starting_stake, BPS));
    assert!(
        raider_net < fair_net,
        "raider {} keeper {} stake {}",
        raider_net,
        fair_net,
        starting_stake
    );
}
