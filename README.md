# $TIDE

A NEP-141 memecoin whose unminted supply is a living fish stock that holders fish into existence, can fish to extinction, and police themselves.

[Live app](https://tidenear.astromind.cc) | Track: `memecoins` | Licence: MIT | Network: testnet

## What it is

The sea is unminted TIDE supply: a stock that grows each season and can cross an Allee threshold into decline. A holder stakes TIDE as a boat, then chooses fishing effort. Catch is minted to the boat and fuel is burned from its balance. Every boat has a fair share of the seasonal quota; taking more is allowed but creates a public indictment and can block unstaking until the assembly closes. A two-stage assembly can exile a boat for ten seasons without confiscating its TIDE.

## Play it

[Open the live app](https://tidenear.astromind.cc).

1. Connect MetaMask and let the app create or resume a NEAR eth-implicit account.
2. Claim the one-time 100,000 TIDE testnet faucet.
3. Launch a boat by staking at least 1,000 TIDE.
4. Choose effort to fish once per season, and vote or write a shard during an assembly.

[Replay the sea without a wallet](https://tidenear.astromind.cc/#/replay).

## The mechanic

1. The sea is unminted supply `S`. It starts at 700,000 fish and grows once per season under `g(S) = r * S * (1 - S/K) * (S - A) / K`; `K` starts at 1,000,000, `r = 0.6`, and the Allee threshold `A` is 120,000. Below `A`, growth is negative and the stock moves toward extinction.
2. An account may have one boat. Staking builds or tops up that boat; a deposit in season `s` can first fish in `s + 1`. Catch uses the opening stock and fleet snapshot, so transaction order does not change catch.
3. Effort is 1 to 10,000 basis points. Catch is proportional to stake, effort, and the boat's share of the fleet; the whole fleet at full effort can take at most 25% of the opening stock. Fuel burned is `0.002 * stake * effort` at full effort.
4. A boat's fair share is `quota * stake / fleet`, where the quota is 58,524 fish, 80% of the 73,155-fish maximum sustainable yield. Catch above fair share is permitted but recorded as a public indictment for that assembly.
5. Every third season is an assembly. In stage 1, eligible boats vote whether to hold an ostracism; yes must be more than half of eligible boats. In stage 2, each eligible boat writes one to three NEAR account names on a shard.
6. A name written by at least 40% of eligible boats is exiled when the season closes. Exile lasts 10 seasons and blocks fishing, unstaking, transfers, and voting; the boat's TIDE is not confiscated. Its stake remains in the fleet denominator, so its unused quota share stays in the sea.
7. THE RECKONING begins when a season closes below the Allee threshold. A wreck burns half of every boat's stake and returns half to its wallet. This collective liability is part of the rule: it makes pulling back rational for a dominant overfisher as well as for the rest of the fleet.
8. During a wreck, contributors can permanently burn 1,000,000 TIDE to fund a reseed within 60 seasons. A funded reseed starts at 70% of the new capacity; capacity falls 20% per generation while `A` stays at 120,000. If it is not funded, the sea returns through the poor fallback at the larger of 240,000 fish or 30% of new capacity, then burns half of every catch for 30 recovery seasons.
9. There is no owner, administrator, parameter setter, or cron dependency. Any state-changing call, including `tick`, settles up to 40 elapsed seasons, and deployment deletes every access key from the contract account.

The compile-time constants in `contract/src/sea.rs` are:

| Constant | Value | Meaning |
| --- | ---: | --- |
| `DECIMALS` / `ONE` | 18 / `10^18` | TIDE decimals / one TIDE in token units |
| `MICRO` / `UNITS_PER_MICRO` | `10^6` / `10^12` | Micro-fish precision / token units per micro-fish |
| `BPS` / `PPM` | 10,000 / 1,000,000 | Basis-point / parts-per-million scales |
| `K_FISH` / `A_FISH` / `R_BPS` | 1,000,000 / 120,000 / 6,000 | Initial `K` / Allee `A` / `r = 0.6` |
| `INITIAL_STOCK_FISH` | 700,000 | Initial unminted stock |
| `MAX_TAKE_BPS` / `FUEL_PPM` | 2,500 / 2,000 | 25% full-effort cap / 0.002 fuel at full effort |
| `QUOTA_FISH` | 58,524 | Quota fish per season, 80% of MSY |
| `MIN_STAKE` / `BUILD_BURN_BPS` | 1,000 TIDE / 100 | Vote minimum / 1% boat-deposit burn |
| `ASSEMBLY_EVERY` / `EXILE_SEASONS` | 3 / 10 seasons | Assembly cadence / exile duration |
| `NAMES_PER_SHARD` / `QUORUM_BPS` / `SHARD_BURN` | 3 / 4,000 / 1 TIDE | Names / 40% quorum / burn per name |
| `WRECK_BURN` / `RESEED_COST` | 50% / 1,000,000 TIDE | Wreck burn / funded reseed cost |
| `RECOVERY_TAX` / `MAX_CATCHUP` | 50% / 40 seasons | Recovery burn / maximum settlement |

TIDE supply changes through these fixed rules:

| Event | Mint or burn |
| --- | --- |
| Genesis and catch | Mint genesis balances and catch; catch is accounted for when its season closes |
| Testnet faucet | Mint the fixed deployment amount once per account when enabled |
| Fishing fuel | Burn `FUEL_PPM * stake * effort` |
| Boat deposit | Burn 1% of every stake deposit |
| Shard | Burn 1 TIDE per account name written |
| Reseed | Burn each voluntary contribution permanently |
| Wreck | Burn half of every boat's stake and return the other half |
| Recovery | Burn half of catch for 30 seasons |
| Exile | Burn and confiscate nothing |

## Why these parameters

`python3 sim/tide_sim.py` regenerates the governance table:

| Scenario | Final stock | Below A | Fisher APR | Exiles | Wrong faction | Edge |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 10% staked: open access | 78 | 9 | +20.6% | 0 | 0 | |
| 10% staked: TIDE, same crowd + ostracism | 931,909 | None | +178.7% | 50 | 0 | |
| 50% staked: open access | 435,206 | None | +2.0% | 0 | 0 | |
| 50% staked: TIDE, same crowd + ostracism | 931,909 | None | +21.4% | 50 | 0 | |
| 50% staked: benchmark, everyone keeps quota | 896,332 | None | +23.3% | 0 | 0 | |
| 50%: 30% faction, naive rules | 896,332 | None | +23.3% | 120 | 120 | 3.44x |
| 50%: 30% faction, TIDE rules | 896,332 | None | +23.3% | 0 | 0 | 1.00x |
| 10% staked: all greedy | 37 | 8 | +18.9% | 0 | 0 | |

At 10% staked, open access crosses the line while the governed run survives with 50 exiles and no wrongful exiles. At 50% staked, governance returns +21.4% APR versus +2.0% for open access.
`python3 sim/tide_supply.py` regenerates the one-year supply table:

| Staked | Behaviour | Net supply 1y | Fisher APR | Minted | Burned | Stock end | Dead |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | --- |
| 20% | quota | +17.0% | +79.5% | 21,361,216 | 4,356,932 | 896,332 | None |
| 20% | greedy | +0.3% | +2.3% | 1,019,056 | 760,940 | 122,949 | None |
| 50% | quota | +10.8% | +21.5% | 21,361,216 | 10,583,594 | 896,332 | None |
| 50% | greedy | +0.1% | +1.3% | 11,511,469 | 11,386,093 | 428,048 | None |
| 70% | quota | +6.8% | +10.4% | 21,361,216 | 14,538,095 | 896,332 | None |
| 70% | greedy | +0.3% | +1.5% | 19,914,297 | 19,567,554 | 594,720 | None |
| 90% | quota | +3.0% | +4.3% | 21,361,216 | 18,342,365 | 896,332 | None |
| 90% | greedy | +0.3% | +1.4% | 25,476,019 | 25,130,674 | 645,389 | None |

Fuel burn makes quota-keeping net inflation fall from +17.0% at 20% staked to +3.0% at 90% staked. Greedy fishing produces much less fisher APR and materially less surviving stock.
`python3 sim/tide_reckoning.py` regenerates the reckoning trace and loss/grab ratios:

| Opening stock | Wreck loss versus final grab |
| ---: | ---: |
| 700,000 fish | 265x |
| 300,000 fish | 618x |
| 120,000 fish, the line | 1,545x |
| Across three generations | 978x |

The modeled raider's final grab is 978x smaller than its wreck loss across three generations. As stock approaches the line, the loss-to-grab ratio rises, so the rational endgame shifts from grabbing to pulling back.

## Run it yourself

Prerequisites: Rust, `cargo-near`, `near-cli-rs` 0.31, Node 22, Python 3, and a funded testnet account whose key is in the legacy keychain.
```bash
git clone https://github.com/calledAdo/tide.git
cd tide
./scripts/check.sh
```

The check prints `Long-line check: 0`, the three simulation tables, contract tests, the app simulation check, and, when all checks pass, `ALL CHECKS PASSED` as its final line.
To open the app locally:
```bash
cd app
npm ci
npm run dev
```

Open `http://localhost:5173`. To deploy a new sea to testnet, use a funded account as `MASTER`; the script builds the contract, creates six demo accounts, initializes the faucet, removes every contract access key, and writes `scripts/.env.demo`:
```bash
cd ..
MASTER=you.testnet ./scripts/deploy-testnet.sh
./scripts/demo.sh
```

Set the printed contract in `app/src/config.ts` before deploying a local or hosted app. `DRY_RUN=1 MASTER=example.testnet ./scripts/deploy-testnet.sh` prints the deployment commands without using the network.

## How it is built
The contract is Rust with `near-sdk 5.30.1` and `near-contract-standards`; it is keyless after deployment. The live contract is [`sea.tide-fund-94145.testnet`](https://testnet.nearblocks.io/address/sea.tide-fund-94145.testnet).
The app is React 19 + Vite and uses MetaMask on NEAR through eth-implicit accounts on EVM chain 398. On first connection, the sponsor can provide 0.5 testnet NEAR and token registration, then MetaMask approves the limited relayer key; every action still requires confirmation.
The Node 22 service runs the keeper, six demo captains, and an event indexer behind the app's `/api` path. Its operational runbook is [`server/README.md`](server/README.md).

| Public method | Type | Purpose |
| --- | --- | --- |
| `new(genesis, season_len_sec, faucet_amount)` | change/init | Initialize balances, clock, sea, and faucet |
| `tick()` | change | Settle elapsed seasons and assemblies |
| `settle_wreck()` | change | Process wrecked boats and attempt reseeding |
| `stake(amount)` | change | Build or top up a boat; burn 1% |
| `unstake(amount)` | change | Return stake unless exile or indictment blocks it |
| `fish(effort_bps)` | change | Mint catch and burn fuel |
| `contribute_reseed({ amount })` | change | Burn TIDE to fund the next sea |
| `vote_hold(yes)` | change | Cast the stage 1 assembly vote |
| `write_shard(names)` | change | Write up to three names and burn 1 TIDE/name |
| `claim_faucet()` | change | Claim the deployment faucet once |
| `get_params()` | view | Return fixed constants and deployment settings |
| `get_sea()` | view | Return projected stock, season, stage, supply, and totals |
| `get_boat(account_id)` | view | Return boat, fair share, catch, fuel, and exile status |
| `get_assembly()` | view | Return ballots, shards, quorum, and last result |
| `get_indictments(cycle)` | view | Return names and overage for a cycle |
| `get_exiles()` | view | Return exiled names and release seasons |
| `get_reckoning()` | view | Return phase, reseed drive, contributors, and history |
| `ft_transfer(receiver_id, amount, memo)` | change | NEP-141 transfer; exiled senders are blocked |
| `ft_transfer_call(receiver_id, amount, memo, msg)` | change | NEP-141 transfer-and-call; exile blocked |
| `ft_total_supply()` | view | Return total TIDE supply |
| `ft_balance_of(account_id)` | view | Return an account's TIDE balance |
| `storage_deposit(account_id, registration_only)` | payable change | Register NEP-141 storage |
| `storage_withdraw(amount)` | payable change | Withdraw available storage balance |
| `storage_unregister(force)` | payable change | Unregister an account with no staked boat |
| `storage_balance_bounds()` | view | Return NEP-145 storage bounds |
| `storage_balance_of(account_id)` | view | Return an account's storage balance |
| `ft_metadata()` | view | Return NEP-148 metadata |
| `ft_resolve_transfer(...)` | private callback | Resolve `ft_transfer_call` in the runtime |

## Honest limits
- Voting is one vote per boat, with a minimum stake of 1,000 TIDE and a one-season age requirement; a whale that splits early across accounts gains votes.
- With no honest majority, there is no rescue.
- A wreck burns half of every boat, including boats that fished fairly, and returns half to each wallet. This deliberate collective liability is why the fleet must police itself and why a dominant overfisher cannot grief cheaply.
- An exiled owner can build a freshly funded boat from another account; it costs 1% and requires fresh capital.
- Seasons settle lazily, at most 40 per call; the page blocks actions above 40 unsettled seasons. The keeper is a convenience process, and anyone can call `tick`.
- Views project unsettled seasons but do not replay assemblies; call `tick` to settle an assembly on chain.
- On-chain randomness is not used. The live page supports wallet actions, while the CLI remains useful for independent inspection.
- The faucet is testnet-only and exists only on deployments initialized with a nonzero amount.
- The sponsor can run out of testnet NEAR; onboarding refuses to operate below 1 NEAR and is limited to once per account per day, five accounts per client IP per day, and the configured daily cap.
- The six demo captains are bots run by the project, not privileged contract actors. MetaMask players confirm every action, the dev signer is localhost-only, and nothing is audited.

## Why NEAR
Human-readable account names make a shard readable. A contract can hold no access keys after deployment. Cheap per-season transactions make the repeated fishing and assembly actions practical. TIDE uses NEP-141 and NEP-297 events for token and governance activity.

## Research
Gordon (1954); Schaefer (1954); Hardin (1968); Ostrom (1990); Fehr & Gachter (2000); Levhari & Mirman (1980); Forsdyke (2005), including ostracism and Hyperbolus in 417 BC.

## Credits and licence
Specifications and review were by the author with Claude Code; implementation was delegated to OpenAI Codex, then reviewed and tested by the author.
Big Shoulders Display, Inter Tight, and JetBrains Mono are bundled under the SIL Open Font License 1.1. The project is licensed under MIT.
```text
.
├── app/ # React 19 and Vite playable app
├── contract/ # Rust NEP-141 contract and tests
├── server/ # Node 22 keeper, bots, onboarding, and indexer
├── sim/ # Python governance, supply, and reckoning models
├── scripts/ # Checks, testnet deployment, and demo commands
├── LICENSE # MIT licence
└── README.md # Project flow and reproducibility guide
```
