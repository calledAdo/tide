//! $TIDE: a NEP-141 memecoin whose unminted supply is a living fish stock.
//!
//! * The sea regrows every season (logistic growth with a strong Allee effect). Below the Allee threshold the
//!   sea is dead for good and no $TIDE can ever be minted again.
//! * Holders stake $TIDE as boats. Fishing mints the catch and burns fuel. The whole fleet can take at most 25%
//!   of the stock per season, split by stake.
//! * The quota is NOT enforced by code. Catching more than your fair share is allowed, but it is recorded on chain
//!   as an indictment.
//! * Every third season is an assembly (Athenian ostracism): stage 1 "shall we hold an ostracism?" needs more
//!   than half of eligible boats; stage 2 each boat writes up to 3 NEAR account names on a shard; every name
//!   written by at least 40% of eligible boats is exiled for 10 seasons: no fishing, no unstaking, no transfers,
//!   no voting. Exiled tokens are never taken, and the exiled boat's share of the quota stays in the sea.
//! * No owner, no admin, no setters. Parameters are compile-time constants in `sea.rs`.

pub mod sea;

use near_contract_standards::fungible_token::events::{FtBurn, FtMint};
use near_contract_standards::fungible_token::metadata::{
    FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC,
};
use near_contract_standards::fungible_token::{
    FungibleToken, FungibleTokenCore, FungibleTokenResolver,
};
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::collections::LazyOption;
use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json};
use near_sdk::store::{LookupMap, LookupSet, Vector};
use near_sdk::{
    env, log, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, PromiseOrValue,
};

use sea::*;

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Token,
    Metadata,
    Boats,
    BoatAccounts,
    ExileUntil,
    Exiled,
    HoldVoted,
    ShardVoted,
    Shards,
    Named,
    Indictments,
    FaucetClaimed,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Default)]
pub struct Boat {
    /// Staked TIDE (held by the contract account).
    pub stake: U128,
    /// Season of the last deposit. A boat built or topped up in season s first fishes in season s + 1.
    pub stake_season: u64,
    /// Last season this boat fished (one fishing trip per season).
    pub last_fished: Option<u64>,
    /// Last 3-season cycle in which this boat caught more than its fair share.
    pub indicted_cycle: Option<u64>,
    /// Whether this boat currently counts as an eligible voter.
    pub counted: bool,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    Fishing,
    Wrecked,
    Recovering,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct ReckoningHistory {
    pub generation: u32,
    pub died_season: u64,
    pub burned_total: U128,
    pub boats_wrecked: u32,
    pub reseeded_season: Option<u64>,
    pub funded: bool,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Tide {
    token: FungibleToken,
    metadata: LazyOption<FungibleTokenMetadata>,

    // ---- time ----
    genesis_ns: u64,
    season_len_ns: u64,
    /// The season currently open (everything before it has been settled).
    season: u64,

    // ---- the sea ----
    /// Stock at the opening of `season`, in micro-fish.
    stock_micro: u128,
    /// Total caught so far in `season`, in micro-fish.
    caught_micro: u128,
    dead: bool,
    died_season: Option<u64>,
    generation: u32,
    carrying_capacity: u128,
    phase: Phase,
    reseed_fund: u128,
    wreck_season: Option<u64>,
    recovery_until_season: Option<u64>,
    recovery_burned: u128,
    reseed_contributors: Vec<(AccountId, u128)>,
    reckoning_history: Vec<ReckoningHistory>,
    permanent_loss: bool,
    wreck_pending: bool,
    wreck_cursor: u32,

    // ---- the fleet ----
    boats: LookupMap<AccountId, Boat>,
    boat_accounts: Vector<AccountId>,
    /// All staked TIDE right now.
    staked_total: u128,
    staked_boat_count: u32,
    /// Staked TIDE at the opening of `season`; catches and fair shares are computed against it.
    fleet_snapshot: u128,
    /// Boats with at least MIN_STAKE that are not exiled.
    voter_count: u32,

    // ---- exile ----
    exile_until: LookupMap<AccountId, u64>,
    exiled: Vector<AccountId>,

    // ---- assembly (state of the current cycle) ----
    hold_yes: u32,
    hold_no: u32,
    hold_voted: LookupSet<(u64, AccountId)>,
    shard_voted: LookupSet<(u64, AccountId)>,
    shards: LookupMap<(u64, AccountId), u32>,
    named: Vector<AccountId>,
    /// cycle -> list of (account, total overage in token units)
    indictments: LookupMap<u64, Vec<(AccountId, U128)>>,
    last_assembly: Option<AssemblyResult>,

    // ---- testnet faucet (0 on a real launch; fixed at init like everything else) ----
    faucet_amount: u128,
    faucet_claimed: LookupSet<AccountId>,

    // ---- running totals ----
    minted_catch: u128,
    burned_fuel: u128,
    burned_build: u128,
    burned_shards: u128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct AssemblyResult {
    pub cycle: u64,
    pub eligible: u32,
    pub hold_yes: u32,
    pub hold_no: u32,
    pub held: bool,
    pub exiled: Vec<AccountId>,
}

#[near(serializers = [json])]
pub struct SeaView {
    pub season: u64,
    pub synced: bool,
    pub seasons_behind: u64,
    pub stock_fish: U128,
    pub caught_this_season: U128,
    pub carrying_capacity: U128,
    pub allee_threshold: U128,
    pub msy_stock: U128,
    pub quota_per_season: U128,
    pub dead: bool,
    pub died_season: Option<u64>,
    pub staked_total: U128,
    pub fleet_snapshot: U128,
    pub voter_count: u32,
    pub season_len_sec: u64,
    pub seconds_left_in_season: u64,
    pub assembly: Option<String>,
    pub minted_catch: U128,
    pub burned_fuel: U128,
    pub burned_build: U128,
    pub burned_shards: U128,
    pub recovery_burned: U128,
    pub total_supply: U128,
    pub generation: u32,
    pub phase: Phase,
    pub reseed_fund: U128,
    pub reseed_cost: U128,
    pub reseed_deadline_season: Option<u64>,
    pub recovery_until_season: Option<u64>,
}

#[near(serializers = [json])]
pub struct BoatView {
    pub boat: Boat,
    pub can_fish_now: bool,
    pub exiled_until: Option<u64>,
    pub fair_share: U128,
    pub full_effort_catch: U128,
    pub full_effort_fuel: U128,
}

fn emit(event: &str, data: serde_json::Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({"standard": "tide", "version": "1.0.0", "event": event, "data": [data]})
    ));
}

#[near]
impl Tide {
    /// `genesis`: initial balances. `season_len_sec`: 86400 live, ~180 for a demo.
    /// `faucet_amount`: TIDE units each account may claim once (use 0 for a real launch).
    #[init]
    pub fn new(genesis: Vec<(AccountId, U128)>, season_len_sec: u64, faucet_amount: U128) -> Self {
        require!(season_len_sec >= 30, "season too short");
        let mut this = Self {
            token: FungibleToken::new(StorageKey::Token),
            metadata: LazyOption::new(
                StorageKey::Metadata,
                Some(&FungibleTokenMetadata {
                    spec: FT_METADATA_SPEC.to_string(),
                    name: "TIDE".to_string(),
                    symbol: "TIDE".to_string(),
                    icon: Some(ICON.to_string()),
                    reference: None,
                    reference_hash: None,
                    decimals: DECIMALS,
                }),
            ),
            genesis_ns: env::block_timestamp(),
            season_len_ns: season_len_sec * 1_000_000_000,
            season: 0,
            stock_micro: INITIAL_STOCK_FISH * MICRO,
            caught_micro: 0,
            dead: false,
            died_season: None,
            generation: 0,
            carrying_capacity: K_FISH,
            phase: Phase::Fishing,
            reseed_fund: 0,
            wreck_season: None,
            recovery_until_season: None,
            recovery_burned: 0,
            reseed_contributors: vec![],
            reckoning_history: vec![],
            permanent_loss: false,
            wreck_pending: false,
            wreck_cursor: 0,
            boats: LookupMap::new(StorageKey::Boats),
            boat_accounts: Vector::new(StorageKey::BoatAccounts),
            staked_total: 0,
            staked_boat_count: 0,
            fleet_snapshot: 0,
            voter_count: 0,
            exile_until: LookupMap::new(StorageKey::ExileUntil),
            exiled: Vector::new(StorageKey::Exiled),
            hold_yes: 0,
            hold_no: 0,
            hold_voted: LookupSet::new(StorageKey::HoldVoted),
            shard_voted: LookupSet::new(StorageKey::ShardVoted),
            shards: LookupMap::new(StorageKey::Shards),
            named: Vector::new(StorageKey::Named),
            indictments: LookupMap::new(StorageKey::Indictments),
            last_assembly: None,
            faucet_amount: faucet_amount.0,
            faucet_claimed: LookupSet::new(StorageKey::FaucetClaimed),
            minted_catch: 0,
            burned_fuel: 0,
            burned_build: 0,
            burned_shards: 0,
        };
        let me = env::current_account_id();
        this.token.internal_register_account(&me);
        for (account, amount) in genesis {
            if this.token.accounts.get(&account).is_none() {
                this.token.internal_register_account(&account);
            }
            this.token.internal_deposit(&account, amount.0);
            FtMint {
                owner_id: &account,
                amount,
                memo: Some("genesis"),
            }
            .emit();
        }
        this
    }

    // =====================================================================================
    // Seasons
    // =====================================================================================

    fn current_season_by_clock(&self) -> u64 {
        (env::block_timestamp().saturating_sub(self.genesis_ns)) / self.season_len_ns
    }

    /// Settle every season that has ended (up to MAX_CATCHUP per call). Called by every state-changing method.
    fn sync(&mut self) {
        let target = self.current_season_by_clock();
        let mut steps = 0;
        while self.season < target && steps < MAX_CATCHUP {
            self.close_season();
            steps += 1;
        }
        self.advance_phase();
        self.maybe_reseed(target);
    }

    fn close_season(&mut self) {
        let closing = self.season;
        let next = next_stock_micro_with_capacity(
            self.stock_micro,
            self.caught_micro,
            self.carrying_capacity,
        );
        emit(
            "season_closed",
            json!({"season": closing, "opening_stock": U128(self.stock_micro / MICRO),
                   "caught": U128(self.caught_micro / MICRO), "next_stock": U128(next / MICRO)}),
        );
        if closing % ASSEMBLY_EVERY == ASSEMBLY_EVERY - 1 {
            self.close_assembly(closing / ASSEMBLY_EVERY);
        }
        self.season = closing + 1;
        self.stock_micro = next;
        self.caught_micro = 0;
        if self.phase != Phase::Wrecked && self.stock_micro < A_FISH * MICRO {
            self.wreck_sea();
        }
        self.release_exiles();
        self.fleet_snapshot = self.staked_total;
        self.advance_phase();
    }

    /// Anyone can advance the clock (useful after long quiet periods).
    pub fn tick(&mut self) {
        self.sync();
    }

    fn advance_phase(&mut self) {
        if self.phase == Phase::Recovering
            && self
                .recovery_until_season
                .map_or(false, |until| self.season >= until)
        {
            self.phase = Phase::Fishing;
            self.recovery_until_season = None;
            emit(
                "recovery_complete",
                json!({"season": self.season, "generation": self.generation}),
            );
        }
    }

    fn clear_exile_state(&mut self) {
        let names: Vec<AccountId> = self.exiled.iter().cloned().collect();
        for name in names {
            self.exile_until.remove(&name);
        }
        self.exiled.clear();
        self.hold_yes = 0;
        self.hold_no = 0;
        self.named.clear();
    }

    fn wreck_sea(&mut self) {
        self.phase = Phase::Wrecked;
        self.dead = true;
        self.died_season = Some(self.season);
        self.wreck_season = Some(self.season);
        self.wreck_pending = true;
        self.wreck_cursor = 0;
        let boats_wrecked = self.staked_boat_count;
        let burned_total = self.staked_total * WRECK_BURN_BPS / BPS;
        self.reckoning_history.push(ReckoningHistory {
            generation: self.generation,
            died_season: self.season,
            burned_total: U128(burned_total),
            boats_wrecked,
            reseeded_season: None,
            funded: false,
        });
        self.voter_count = 0;
        self.staked_total = 0;
        self.staked_boat_count = 0;
        self.fleet_snapshot = 0;
        self.clear_exile_state();
        emit(
            "sea_died",
            json!({"season": self.season, "stock": U128(self.stock_micro / MICRO)}),
        );
        emit(
            "reckoning",
            json!({"generation": self.generation, "season": self.season,
                   "stock": U128(self.stock_micro / MICRO), "boats_wrecked": boats_wrecked,
                   "burned_total": U128(burned_total)}),
        );
        self.settle_wreck_batch();
    }

    fn settle_wreck_batch(&mut self) {
        if !self.wreck_pending {
            return;
        }
        let mut processed = 0;
        while processed < WRECK_BATCH && self.wreck_cursor < self.boat_accounts.len() {
            let account = self.boat_accounts.get(self.wreck_cursor).unwrap().clone();
            self.wreck_cursor += 1;
            processed += 1;
            let mut boat = self.boat(&account);
            if boat.stake.0 == 0 {
                continue;
            }
            let stake = boat.stake.0;
            let burned = stake * WRECK_BURN_BPS / BPS;
            let returned = stake - burned;
            let contract = env::current_account_id();
            self.token.internal_withdraw(&contract, burned);
            FtBurn {
                owner_id: &contract,
                amount: U128(burned),
                memo: Some("boat wreck"),
            }
            .emit();
            self.token.internal_transfer(
                &contract,
                &account,
                returned,
                Some("wreck return".to_string()),
            );
            boat.stake = U128(0);
            boat.counted = false;
            self.boats.insert(account.clone(), boat);
            emit(
                "boat_wrecked",
                json!({"account": account, "burned": U128(burned), "returned": U128(returned)}),
            );
        }
        if self.wreck_cursor >= self.boat_accounts.len() {
            self.wreck_pending = false;
        }
    }

    fn maybe_reseed(&mut self, target: u64) {
        if self.phase != Phase::Wrecked || self.permanent_loss || self.wreck_pending {
            return;
        }
        let deadline = self
            .wreck_season
            .map(|s| s + RESEED_DEADLINE)
            .unwrap_or(u64::MAX);
        let funded = self.reseed_fund >= RESEED_COST;
        if !funded && target < deadline && self.season < deadline {
            return;
        }
        if target > self.season {
            self.season = target;
        }
        let next_generation = self.generation + 1;
        let capacity = self.carrying_capacity * K_DECAY_BPS / BPS;
        self.generation = next_generation;
        self.carrying_capacity = capacity;
        if capacity <= A_FISH {
            self.reseed_fund = 0;
            self.permanent_loss = true;
            emit(
                "sea_lost_forever",
                json!({"generation": self.generation, "carrying_capacity": U128(capacity)}),
            );
            self.reseed_contributors.clear();
            return;
        }
        let stock = if funded {
            capacity * RESEED_HEALTHY_BPS / BPS
        } else {
            RESEED_FALLBACK.max(capacity * RESEED_FALLBACK_BPS / BPS)
        };
        let contributors: Vec<(AccountId, U128)> = self
            .reseed_contributors
            .iter()
            .map(|(account, amount)| (account.clone(), U128(*amount)))
            .collect();
        self.stock_micro = stock * MICRO;
        self.caught_micro = 0;
        self.phase = Phase::Recovering;
        self.dead = false;
        self.recovery_until_season = Some(self.season + RECOVERY_SEASONS);
        self.reseed_fund = 0;
        self.wreck_season = None;
        self.reseed_contributors.clear();
        if let Some(history) = self.reckoning_history.last_mut() {
            history.reseeded_season = Some(self.season);
            history.funded = funded;
        }
        emit(
            "reseeded",
            json!({"generation": self.generation, "carrying_capacity": U128(capacity),
                   "stock": U128(stock), "funded": funded, "contributors": contributors}),
        );
    }

    /// Process at most twenty dissolved boats. Calling this after completion is harmless.
    pub fn settle_wreck(&mut self) {
        self.sync();
        if self.phase != Phase::Wrecked {
            return;
        }
        self.settle_wreck_batch();
        self.maybe_reseed(self.current_season_by_clock());
    }

    /// Burn TIDE permanently to fund the community's next sea.
    pub fn contribute_reseed(&mut self, amount: U128) {
        self.sync();
        require!(
            self.phase == Phase::Wrecked && !self.permanent_loss,
            "RESEED NOT AVAILABLE"
        );
        require!(amount.0 > 0, "amount must be positive");
        let who = env::predecessor_account_id();
        self.token.internal_withdraw(&who, amount.0);
        FtBurn {
            owner_id: &who,
            amount,
            memo: Some("reseed contribution"),
        }
        .emit();
        self.reseed_fund += amount.0;
        match self
            .reseed_contributors
            .iter_mut()
            .find(|(account, _)| account == &who)
        {
            Some((_, total)) => *total += amount.0,
            None => self.reseed_contributors.push((who.clone(), amount.0)),
        }
        emit(
            "reseed_contribution",
            json!({"account": who, "amount": amount, "fund": U128(self.reseed_fund)}),
        );
        self.maybe_reseed(self.current_season_by_clock());
    }

    // =====================================================================================
    // Boats
    // =====================================================================================

    fn boat(&self, account: &AccountId) -> Boat {
        self.boats.get(account).cloned().unwrap_or_default()
    }

    fn is_exiled(&self, account: &AccountId) -> bool {
        self.exile_until
            .get(account)
            .map_or(false, |until| *until > self.season)
    }

    fn assert_not_exiled(&self, account: &AccountId) {
        if let Some(until) = self.exile_until.get(account) {
            if *until > self.season {
                env::panic_str(&format!("EXILED until season {}", until));
            }
        }
    }

    fn recount(&mut self, account: &AccountId, boat: &mut Boat) {
        let should = boat.stake.0 >= MIN_STAKE && !self.is_exiled(account);
        if should && !boat.counted {
            self.voter_count += 1;
        } else if !should && boat.counted {
            self.voter_count -= 1;
        }
        boat.counted = should;
    }

    /// Stake TIDE as a boat. 1% of the deposit is burned (the boat is built). Takes effect next season.
    pub fn stake(&mut self, amount: U128) {
        self.sync();
        require!(
            self.phase != Phase::Wrecked && !self.permanent_loss,
            "THE SEA IS DEAD"
        );
        let who = env::predecessor_account_id();
        self.assert_not_exiled(&who);
        require!(amount.0 > 0, "amount must be positive");
        let burn = amount.0 * BUILD_BURN_BPS / BPS;
        let net = amount.0 - burn;
        self.token.internal_withdraw(&who, burn);
        FtBurn {
            owner_id: &who,
            amount: U128(burn),
            memo: Some("boat built"),
        }
        .emit();
        self.burned_build += burn;
        let me = env::current_account_id();
        self.token
            .internal_transfer(&who, &me, net, Some("stake".to_string()));
        let mut boat = self.boat(&who);
        if boat.stake.0 == 0 {
            if self.boats.get(&who).is_none() {
                self.boat_accounts.push(who.clone());
            }
            self.staked_boat_count += 1;
        }
        boat.stake = U128(boat.stake.0 + net);
        boat.stake_season = self.season;
        self.staked_total += net;
        self.recount(&who, &mut boat);
        emit(
            "boat_staked",
            json!({"account": who, "stake": boat.stake, "burned": U128(burn)}),
        );
        self.boats.insert(who, boat);
    }

    /// Unstake. Blocked while exiled, and while indicted until the assembly of that cycle has closed.
    pub fn unstake(&mut self, amount: U128) {
        self.sync();
        require!(self.phase != Phase::Wrecked, "THE SEA IS WRECKED");
        let who = env::predecessor_account_id();
        self.assert_not_exiled(&who);
        let mut boat = self.boat(&who);
        require!(amount.0 > 0 && amount.0 <= boat.stake.0, "not enough stake");
        if let Some(c) = boat.indicted_cycle {
            let closes_after = c * ASSEMBLY_EVERY + ASSEMBLY_EVERY - 1;
            if self.season <= closes_after {
                env::panic_str(&format!(
                    "INDICTED: cannot unstake until the assembly of cycle {} closes (end of season {})",
                    c, closes_after
                ));
            }
        }
        boat.stake = U128(boat.stake.0 - amount.0);
        self.staked_total -= amount.0;
        if boat.stake.0 == 0 {
            self.staked_boat_count -= 1;
        }
        let me = env::current_account_id();
        self.token
            .internal_transfer(&me, &who, amount.0, Some("unstake".to_string()));
        self.recount(&who, &mut boat);
        emit(
            "boat_unstaked",
            json!({"account": who, "stake": boat.stake}),
        );
        self.boats.insert(who, boat);
    }

    /// Fish this season at `effort_bps` (1..=10000 = 0.01%..100% of your boat's full power).
    /// The catch is minted to you; fuel is burned from your balance. Catching more than your fair share
    /// is allowed but recorded as an indictment.
    pub fn fish(&mut self, effort_bps: u16) -> U128 {
        self.sync();
        require!(
            self.phase != Phase::Wrecked && !self.permanent_loss,
            "THE SEA IS DEAD"
        );
        let who = env::predecessor_account_id();
        self.assert_not_exiled(&who);
        let effort = effort_bps as u128;
        require!(effort > 0 && effort <= BPS, "effort_bps must be 1..=10000");
        let mut boat = self.boat(&who);
        require!(boat.stake.0 > 0, "no boat: stake TIDE first");
        require!(
            boat.stake_season < self.season,
            "your boat was built or topped up this season: fish next season"
        );
        require!(
            boat.last_fished != Some(self.season),
            "already fished this season"
        );

        let fleet = self.fleet_snapshot;
        let stake = boat.stake.0.min(fleet);
        let catch = catch_units(self.stock_micro, stake, fleet, effort);
        let fuel = fuel_units(stake, effort);
        let share = fair_share_for_capacity_units(stake, fleet, self.carrying_capacity);
        let recovery_burned = if self.phase == Phase::Recovering {
            catch * RECOVERY_TAX_BPS / BPS
        } else {
            0
        };
        let minted = catch - recovery_burned;

        self.token.internal_deposit(&who, minted);
        FtMint {
            owner_id: &who,
            amount: U128(minted),
            memo: Some("catch"),
        }
        .emit();
        self.token.internal_withdraw(&who, fuel);
        FtBurn {
            owner_id: &who,
            amount: U128(fuel),
            memo: Some("fuel"),
        }
        .emit();
        self.minted_catch += minted;
        self.recovery_burned += recovery_burned;
        self.burned_fuel += fuel;
        self.caught_micro += catch / UNITS_PER_MICRO;
        boat.last_fished = Some(self.season);

        emit(
            "catch",
            json!({"account": who, "season": self.season, "effort_bps": effort_bps,
                   "catch": U128(minted), "fish_taken": U128(catch),
                   "recovery_burned": U128(recovery_burned), "fuel": U128(fuel),
                   "fair_share": U128(share)}),
        );
        if catch > share {
            let over = catch - share;
            let cycle = self.season / ASSEMBLY_EVERY;
            boat.indicted_cycle = Some(cycle);
            let mut list = self.indictments.get(&cycle).cloned().unwrap_or_default();
            match list.iter_mut().find(|(a, _)| a == &who) {
                Some(entry) => entry.1 = U128(entry.1 .0 + over),
                None => list.push((who.clone(), U128(over))),
            }
            self.indictments.insert(cycle, list);
            emit(
                "indicted",
                json!({"account": who, "season": self.season, "cycle": cycle, "over_share": U128(over)}),
            );
        }
        self.boats.insert(who, boat);
        U128(minted)
    }

    // =====================================================================================
    // Assembly
    // =====================================================================================

    /// "hold" during the first half of an assembly season, "shards" during the second half, None otherwise.
    fn assembly_stage(&self) -> Option<&'static str> {
        self.stage_at(self.season)
    }

    fn stage_at(&self, season: u64) -> Option<&'static str> {
        if season % ASSEMBLY_EVERY != ASSEMBLY_EVERY - 1 {
            return None;
        }
        let into =
            env::block_timestamp().saturating_sub(self.genesis_ns + season * self.season_len_ns);
        Some(if into < self.season_len_ns / 2 {
            "hold"
        } else {
            "shards"
        })
    }

    fn assert_voter(&self, who: &AccountId) -> Boat {
        self.assert_not_exiled(who);
        let boat = self.boat(who);
        require!(
            boat.stake.0 >= MIN_STAKE,
            "only boats with at least 1,000 TIDE staked can vote"
        );
        require!(
            boat.stake_season < self.season,
            "boats built this season cannot vote yet"
        );
        boat
    }

    /// Stage 1: "Shall we hold an ostracism this cycle?"
    pub fn vote_hold(&mut self, yes: bool) {
        self.sync();
        require!(
            self.assembly_stage() == Some("hold"),
            "not the first half of an assembly season"
        );
        let who = env::predecessor_account_id();
        self.assert_voter(&who);
        let cycle = self.season / ASSEMBLY_EVERY;
        require!(
            self.hold_voted.insert((cycle, who.clone())),
            "already voted"
        );
        if yes {
            self.hold_yes += 1;
        } else {
            self.hold_no += 1;
        }
        emit(
            "hold_vote",
            json!({"account": who, "cycle": cycle, "yes": yes}),
        );
    }

    /// Stage 2: write up to 3 NEAR account names on your shard. Costs 1 TIDE per name (burned).
    pub fn write_shard(&mut self, names: Vec<AccountId>) {
        self.sync();
        require!(
            self.assembly_stage() == Some("shards"),
            "not the second half of an assembly season"
        );
        require!(
            self.hold_yes * 2 > self.voter_count,
            "the assembly voted not to hold an ostracism"
        );
        require!(
            !names.is_empty() && names.len() <= NAMES_PER_SHARD,
            "write 1 to 3 names"
        );
        let who = env::predecessor_account_id();
        self.assert_voter(&who);
        let cycle = self.season / ASSEMBLY_EVERY;
        require!(
            self.shard_voted.insert((cycle, who.clone())),
            "already wrote a shard"
        );
        let mut seen: Vec<&AccountId> = vec![];
        for name in &names {
            require!(!seen.contains(&name), "duplicate name");
            require!(
                self.boats.contains_key(name),
                "only boats can be ostracised"
            );
            seen.push(name);
            let key = (cycle, name.clone());
            let n = self.shards.get(&key).copied().unwrap_or(0);
            if n == 0 {
                self.named.push(name.clone());
            }
            self.shards.insert(key, n + 1);
        }
        let burn = SHARD_BURN * names.len() as u128;
        self.token.internal_withdraw(&who, burn);
        FtBurn {
            owner_id: &who,
            amount: U128(burn),
            memo: Some("shard"),
        }
        .emit();
        self.burned_shards += burn;
        emit(
            "shard",
            json!({"account": who, "cycle": cycle, "names": names}),
        );
    }

    fn close_assembly(&mut self, cycle: u64) {
        let eligible = self.voter_count;
        let held = self.hold_yes * 2 > eligible;
        let mut exiled_now = vec![];
        if held {
            let needed = (QUORUM_BPS * eligible as u128 + BPS - 1) / BPS; // ceil(40% of eligible)
            let names: Vec<AccountId> = self.named.iter().cloned().collect();
            for name in names {
                let n = self
                    .shards
                    .get(&(cycle, name.clone()))
                    .copied()
                    .unwrap_or(0) as u128;
                if n >= needed.max(1) {
                    exiled_now.push(name);
                }
            }
        }
        let until = self.season + 1 + EXILE_SEASONS;
        for name in &exiled_now {
            self.exile_until.insert(name.clone(), until);
            self.exiled.push(name.clone());
            if let Some(mut boat) = self.boats.get(name).cloned() {
                self.recount(name, &mut boat); // exile_until > season already, so the boat stops counting
                self.boats.insert(name.clone(), boat);
            }
            emit(
                "exiled",
                json!({"account": name, "cycle": cycle, "until_season": until}),
            );
        }
        let result = AssemblyResult {
            cycle,
            eligible,
            hold_yes: self.hold_yes,
            hold_no: self.hold_no,
            held,
            exiled: exiled_now,
        };
        emit("assembly_closed", serde_json::to_value(&result).unwrap());
        self.last_assembly = Some(result);
        self.hold_yes = 0;
        self.hold_no = 0;
        self.named.clear();
    }

    fn release_exiles(&mut self) {
        let mut i = 0;
        while i < self.exiled.len() {
            let name = self.exiled[i].clone();
            let until = self.exile_until.get(&name).copied().unwrap_or(0);
            if until <= self.season {
                self.exiled.swap_remove(i);
                if let Some(mut boat) = self.boats.get(&name).cloned() {
                    self.recount(&name, &mut boat);
                    self.boats.insert(name.clone(), boat);
                }
                emit(
                    "returned_from_exile",
                    json!({"account": name, "season": self.season}),
                );
            } else {
                i += 1;
            }
        }
    }

    // =====================================================================================
    // Testnet faucet
    // =====================================================================================

    /// Claim the testnet faucet once per account (disabled when faucet_amount is 0).
    pub fn claim_faucet(&mut self) {
        require!(self.faucet_amount > 0, "no faucet on this deployment");
        let who = env::predecessor_account_id();
        require!(self.faucet_claimed.insert(who.clone()), "already claimed");
        if self.token.accounts.get(&who).is_none() {
            env::panic_str("register first with storage_deposit");
        }
        self.token.internal_deposit(&who, self.faucet_amount);
        FtMint {
            owner_id: &who,
            amount: U128(self.faucet_amount),
            memo: Some("faucet"),
        }
        .emit();
    }

    // =====================================================================================
    // Views
    // =====================================================================================

    /// What the sea would look like once the pending seasons are settled (views cannot write state).
    /// Assemblies are not replayed here; `tick()` settles them for real.
    fn projected(&self) -> (u64, u128, u128) {
        let target = self.current_season_by_clock();
        if target == self.season {
            return (self.season, self.stock_micro, self.fleet_snapshot);
        }
        let mut stock = next_stock_micro_with_capacity(
            self.stock_micro,
            self.caught_micro,
            self.carrying_capacity,
        );
        let mut season = self.season + 1;
        while season < target && season < self.season + 1_000 {
            stock = next_stock_micro_with_capacity(stock, 0, self.carrying_capacity);
            season += 1;
        }
        (target, stock, self.staked_total)
    }

    pub fn get_params(&self) -> serde_json::Value {
        json!({
            "carrying_capacity_fish": K_FISH, "allee_threshold_fish": A_FISH, "growth_rate": "0.6",
            "initial_stock_fish": INITIAL_STOCK_FISH, "max_fleet_take": "25% of stock per season",
            "fuel_per_staked_token_at_full_effort": "0.002", "quota_fish_per_season": QUOTA_FISH,
            "min_stake": U128(MIN_STAKE), "build_burn": "1%", "assembly_every_seasons": ASSEMBLY_EVERY,
            "exile_seasons": EXILE_SEASONS, "names_per_shard": NAMES_PER_SHARD, "quorum": "40% of eligible boats",
            "stage1": "more than half of eligible boats", "shard_burn": U128(SHARD_BURN),
            "wreck_burn": "50% of stake", "capacity_decay": "80% per generation",
            "reseed_cost": U128(RESEED_COST), "reseed_deadline": RESEED_DEADLINE,
            "recovery_seasons": RECOVERY_SEASONS, "recovery_tax": "50% of catch",
            "season_len_sec": self.season_len_ns / 1_000_000_000, "faucet_amount": U128(self.faucet_amount),
            "admin": null
        })
    }

    pub fn get_sea(&self) -> SeaView {
        let by_clock = self.current_season_by_clock();
        let end = self.genesis_ns + (by_clock + 1) * self.season_len_ns;
        let (_, stock, fleet) = self.projected();
        let synced = by_clock == self.season;
        SeaView {
            season: by_clock,
            synced,
            seasons_behind: by_clock - self.season,
            stock_fish: U128(stock / MICRO),
            caught_this_season: U128(if synced { self.caught_micro / MICRO } else { 0 }),
            carrying_capacity: U128(self.carrying_capacity),
            allee_threshold: U128(A_FISH),
            msy_stock: U128(msy_stock_fish(self.carrying_capacity)),
            quota_per_season: U128(quota_fish_for_capacity(self.carrying_capacity)),
            dead: self.dead || self.permanent_loss || stock < A_FISH * MICRO,
            died_season: self.died_season,
            staked_total: U128(self.staked_total),
            fleet_snapshot: U128(fleet),
            voter_count: self.voter_count,
            season_len_sec: self.season_len_ns / 1_000_000_000,
            seconds_left_in_season: end.saturating_sub(env::block_timestamp()) / 1_000_000_000,
            assembly: self.stage_at(by_clock).map(|s| s.to_string()),
            minted_catch: U128(self.minted_catch),
            burned_fuel: U128(self.burned_fuel),
            burned_build: U128(self.burned_build),
            burned_shards: U128(self.burned_shards),
            recovery_burned: U128(self.recovery_burned),
            total_supply: U128(self.token.total_supply),
            generation: self.generation,
            phase: self.phase,
            reseed_fund: U128(self.reseed_fund),
            reseed_cost: U128(RESEED_COST),
            reseed_deadline_season: self.wreck_season.map(|s| s + RESEED_DEADLINE),
            recovery_until_season: self.recovery_until_season,
        }
    }

    pub fn get_boat(&self, account_id: AccountId) -> Option<BoatView> {
        let boat = self.boats.get(&account_id)?.clone();
        let (season, stock, fleet) = self.projected();
        let stake = boat.stake.0.min(fleet);
        let exiled_until = self
            .exile_until
            .get(&account_id)
            .copied()
            .filter(|u| *u > season);
        Some(BoatView {
            can_fish_now: self.phase != Phase::Wrecked
                && !self.permanent_loss
                && stock >= A_FISH * MICRO
                && exiled_until.is_none()
                && boat.stake.0 > 0
                && boat.stake_season < season
                && boat.last_fished != Some(season),
            exiled_until,
            fair_share: U128(fair_share_for_capacity_units(
                stake,
                fleet,
                self.carrying_capacity,
            )),
            full_effort_catch: U128(catch_units(stock, stake, fleet, BPS)),
            full_effort_fuel: U128(fuel_units(stake, BPS)),
            boat,
        })
    }

    pub fn get_assembly(&self) -> serde_json::Value {
        let cycle = self.season / ASSEMBLY_EVERY;
        let shards: Vec<(AccountId, u32)> = self
            .named
            .iter()
            .map(|n| {
                (
                    n.clone(),
                    self.shards.get(&(cycle, n.clone())).copied().unwrap_or(0),
                )
            })
            .collect();
        json!({
            "cycle": cycle, "stage": self.assembly_stage(), "eligible": self.voter_count,
            "hold_yes": self.hold_yes, "hold_no": self.hold_no,
            "quorum_shards": ((QUORUM_BPS * self.voter_count as u128 + BPS - 1) / BPS).max(1),
            "shards": shards, "last_result": self.last_assembly,
        })
    }

    pub fn get_indictments(&self, cycle: u64) -> Vec<(AccountId, U128)> {
        self.indictments.get(&cycle).cloned().unwrap_or_default()
    }

    pub fn get_exiles(&self) -> Vec<(AccountId, u64)> {
        self.exiled
            .iter()
            .map(|n| (n.clone(), self.exile_until.get(n).copied().unwrap_or(0)))
            .collect()
    }

    pub fn get_reckoning(&self) -> serde_json::Value {
        let contributors: Vec<(AccountId, U128)> = self
            .reseed_contributors
            .iter()
            .map(|(account, amount)| (account.clone(), U128(*amount)))
            .collect();
        let history = serde_json::to_value(&self.reckoning_history).unwrap();
        json!({
            "generation": self.generation,
            "phase": match self.phase {
                Phase::Fishing => "Fishing",
                Phase::Wrecked => "Wrecked",
                Phase::Recovering => "Recovering",
            },
            "wreck_season": self.wreck_season,
            "reseed_fund": U128(self.reseed_fund),
            "reseed_cost": U128(RESEED_COST),
            "contributors": contributors,
            "deadline_season": self.wreck_season.map(|s| s + RESEED_DEADLINE),
            "history": history,
        })
    }
}

// =========================================================================================
// NEP-141 with the exile rule (exiled accounts cannot send)
// =========================================================================================

#[near]
impl FungibleTokenCore for Tide {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.sync();
        self.assert_not_exiled(&env::predecessor_account_id());
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.sync();
        self.assert_not_exiled(&env::predecessor_account_id());
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for Tide {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        let (used, burned) =
            self.token
                .internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        if burned > 0 {
            log!("Account @{} burned {}", sender_id, burned);
        }
        used.into()
    }
}

#[near]
impl StorageManagement for Tide {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        let who = env::predecessor_account_id();
        require!(self.boat(&who).stake.0 == 0, "unstake your boat first");
        self.assert_not_exiled(&who);
        if let Some((_, balance)) = self.token.internal_storage_unregister(force) {
            if balance > 0 {
                FtBurn {
                    owner_id: &who,
                    amount: U128(balance),
                    memo: Some("unregister"),
                }
                .emit();
            }
            true
        } else {
            false
        }
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for Tide {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        self.metadata.get().unwrap()
    }
}

const ICON: &str = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Ccircle cx='32' cy='32' r='32' fill='%230b4f6c'/%3E%3Cpath d='M8 38c6-6 12-6 18 0s12 6 18 0 12-6 14-2v14H8z' fill='%2301baef'/%3E%3Cpath d='M22 26c6-6 16-6 22 0-6 6-16 6-22 0z' fill='%23fbfbff'/%3E%3Cpath d='M44 26l6-5v10z' fill='%23fbfbff'/%3E%3C/svg%3E";

#[cfg(test)]
mod tests;
