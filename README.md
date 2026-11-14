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

## Why a fishery

H. Scott Gordon (1954), in *The Economic Theory of a Common-Property Resource: The Fishery*, showed that an open-access fishery dissipates its own value.
Boats keep entering while any profit remains, so effort settles where the rent is gone and the stock is far below what it could sustainably produce.
Hardin (1968) later popularised the same shape as *The Tragedy of the Commons*.
Elinor Ostrom (1990), in *Governing the Commons*, showed that real communities escape this without privatisation or an outside enforcer.
They do it when the users themselves set the rules, monitor each other, and apply graduated sanctions; she received the Nobel in 2009.
$TIDE is that argument as a token: the contract supplies the biology and the bookkeeping, and the holders supply the governance.
Whether it survives is an open question that anyone can watch on chain.
This is our fishery: a commons with its rulebook in public, where the consequences cannot be edited after the season starts.

## The words

| Word | In $TIDE it means |
| --- | --- |
| Sea | The contract's unminted TIDE supply and living fish population. |
| Stock | Fish currently available to grow, be caught, or cross the Allee threshold. |
| Capacity | The stock level used by the growth curve; it falls after each generation. |
| Boat | One account's staked TIDE position and fishing rights. |
| Fleet | Every boat with stake right now; your catch is your share of it. |
| Season | A fixed interval in which boats may fish once and governance may settle. |
| Catch | Fish minted to a boat by its fishing effort. |
| Fuel | TIDE burned when a boat fishes. |
| Fair share | That boat's stake-proportional part of the current seasonal quota. |
| Indictment | A record that catch exceeded fair share during an assembly cycle. |
| Assembly | Every third season's two-stage vote on whether to ostracize and whom to name. |
| Ostracism | The assembly process that can exile named boats. |
| Shard | A boat's paid list of up to three account names during stage two. |
| Exile | A ten-season ban on fishing, unstaking, transferring, and voting. |
| Wreck | The terminal event that burns half of every boat's stake. |
| Reckoning | The wreck-and-reseed phase after the sea crosses its Allee threshold. |
| Reseed | A funded return of the sea at 70% of its new capacity. |
| Generation | One post-wreck recovery cycle; capacity falls 20% each generation. |

## The mechanic

1. The sea is unminted supply `S`. It starts at 700,000 fish and grows once per season under `g(S) = r * S * (1 - S/K) * (S - A) / K`; `K` starts at 1,000,000, `r = 0.6`, and the Allee threshold `A` is 120,000. Below `A`, growth is negative and the stock moves toward extinction.
   *Why:* below a critical density a population's growth turns negative (the Allee effect), so collapse is a one-way door rather than a slow decline; that is what makes the endgame a real decision instead of an arithmetic one.
2. An account may have one boat. Staking builds or tops up that boat; a deposit in season `s` can first fish in `s + 1`. Catch uses the opening stock and fleet snapshot, so transaction order does not change catch.
   *Why:* catch is proportional to stake, so splitting into many accounts gains nothing; the one-season delay stops a boat being topped up and fished in the same breath.
3. Effort is 1 to 10,000 basis points. Catch is proportional to stake, effort, and the boat's share of the fleet; the whole fleet at full effort can take at most 25% of the opening stock. Fuel burned is `0.002 * stake * effort` at full effort.
   *Why:* effort costs something, so fishing harder is a real trade-off rather than a free choice. This is the cost side of Gordon's model; without it, maximum effort is always rational.
4. A boat's fair share is `quota * stake / fleet`, where the quota is 80% of the sea's maximum sustainable yield, computed from its current capacity. In generation 0 of this deployment, that is 58,524 fish from a 73,155-fish MSY; both are derived values, not fixed limits. Catch above fair share is permitted but recorded as a public indictment for that assembly.
   *Why:* the contract could simply refuse an oversized catch. It does not, because Ostrom's point is that a commons survives when the users monitor and sanction each other. Hard-coding the limit would answer Hardin's question by force and would prove nothing about a community.
5. Every third season is an assembly. In stage 1, eligible boats vote whether to hold an ostracism; yes must be more than half of eligible boats. In stage 2, each eligible boat writes one to three NEAR account names on a shard.
   *Why:* Athens asked first whether to hold an ostracism at all, and only then took names. One-stage voting is capturable: in 417 BC Nicias and Alcibiades combined their followers to exile Hyperbolus, and Athens never held another ostracism. The simulation reproduces exactly that failure and shows the two-stage rule blocking it.
6. A name written by at least 40% of eligible boats is exiled when the season closes. Exile lasts 10 seasons and blocks fishing, unstaking, transfers, and voting; the boat's TIDE is not confiscated. Its stake remains in the fleet denominator, so its unused quota share stays in the sea.
   *Why:* a sanction that confiscated would be theft and would invite factional voting for profit. Leaving the share unfished means banishing a rival earns you nothing directly, which removes the motive the naive rules create.
7. THE RECKONING begins when a season closes below the Allee threshold. A wreck burns half of every boat's stake and returns half to its wallet. This collective liability is part of the rule: it makes pulling back rational for a dominant overfisher as well as for the rest of the fleet.
   *Why:* a terminal death makes the game finite, and finitely repeated commons games unravel from the end backwards (the Folk Theorem's converse), so the old rule rewarded the final raid. Clark (1973) showed extinction can be privately rational whenever a stock grows more slowly than the return on liquidating it. A raider's wreck loss is roughly 600x its final grab, and the ratio rises as the stock falls. With this deployment's six 9.9M-TIDE boats, that is ~8,000 TIDE versus ~4,950,000 TIDE.
8. During a wreck, contributors can permanently burn 1,000,000 TIDE to fund a reseed within 60 seasons. A funded reseed starts at 70% of the new capacity; capacity falls 20% per generation while `A` stays at 120,000. If it is not funded, the sea returns through the poor fallback at the larger of 240,000 fish or 30% of new capacity, then burns half of every catch for 30 recovery seasons.
   *Why:* the sea must come back or the horizon stays finite, but it must come back worse or collapse costs nothing. Ecologists call the permanent shift a regime shift; the capacity ratchets down 20% a generation while the point of no return does not move, so the safe band narrows every time and the community can still lose the game for good.
9. There is no owner, administrator, parameter setter, or cron dependency. Any state-changing call, including `tick`, settles up to 40 elapsed seasons, and deployment deletes every access key from the contract account.
   *Why:* the contract's game rules are fixed after deployment; only the three deployment values below vary.

### Fixed in the contract

| Rule | Fixed contract rule |
| --- | --- |
| Initial capacity | Starts at 1,000,000 fish before generation decay |
| Biology | Initial stock 700,000 fish; Allee threshold 120,000; `r = 0.6` |
| Fleet cap | The whole fleet at full effort takes at most 25% of opening stock |
| Effort and fuel | Effort is 1-10,000 basis points; full-effort fuel is `0.002 * stake` |
| Quota | 80% of the current capacity's maximum sustainable yield |
| Boat deposit | 1,000 TIDE minimum stake; 1% of each deposit burns |
| Assembly | Every 3 seasons; up to 3 names per shard; 40% quorum; 1 TIDE per name |
| Exile | Lasts 10 seasons and leaves the stake in the fleet denominator |
| Wreck | Burns 50% of every boat's stake and returns 50% to its wallet |
| Reseed | Costs 1,000,000 TIDE, must fund within 60 seasons, and starts at 70% of new capacity |
| Recovery and decay | Capacity falls 20% per generation; recovery burns 50% of catch for 30 seasons |
| Fallback | An unfunded return starts at the larger of 240,000 fish or 30% of new capacity |
| Settlement | Each call settles at most 40 elapsed seasons |

### Set when a sea is deployed

| Value | This deployment |
| --- | --- |
| `genesis` | Six generated demo boat accounts (`ana`, `ben`, `cy`, `dee`, `eve`, `greedy`), each with 10,000,000 TIDE |
| `season_len_sec` | 60 seconds |
| `faucet_amount` | 100,000 TIDE per account; zero on a real launch |

Anyone can deploy a sea with different deployment values, which is why the README states rules rather than treating readings as constants.

### Derived values for this deployment

Capacity, MSY, quota, and each fair share move together; these figures are derived from current capacity.

| Generation | Capacity | MSY | Quota (80% of MSY) |
| --- | ---: | ---: | ---: |
| Generation 0 | 1,000,000 | 73,155 | 58,524 |
| After one wreck | 800,000 | 55,453 | 44,362 |
| After two wrecks | 640,000 | 41,331 | 33,064 |

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

At 10% staked, open access crosses the line while the governed run survives with 50 exiles and no wrongful exiles. At 50% staked, governance returns +21.4% APR versus +2.0% for open access. `python3 sim/tide_supply.py` regenerates the one-year supply table:

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

## How it can be abused

- **Vote splitting.** One vote per boat with a minimum stake and a one-season age; an attacker who splits capital across accounts early buys votes. Not solved; stake-weighted voting with a cap is the obvious fix.
- **Collective liability.** A wreck burns half of every boat, including boats that fished fairly. Deliberate: it is what forces the fleet to police itself rather than free-ride on someone else's restraint.
- **Griefing is bounded, not impossible.** Catch is proportional to stake, so sinking the sea requires a dominant stake — and that stake is what burns. A raider destroys roughly what it pays. A small account cannot move the stock at all.
- **No honest majority, no rescue.** If most of the fleet wants to overfish, nothing in the contract stops them. The simulation's all-greedy scenario ends in collapse, and that is the honest result.
- **Bots.** The demo captains are ordinary accounts run by the project; the contract gives them no privilege.
- **Not audited.** Testnet only.

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

Players can call these eight state-changing methods:

- `claim_faucet` — claim the one-time deployment faucet.
- `stake` — build or top up one boat.
- `unstake` — return stake when exile and indictment rules allow it.
- `fish` — choose effort, mint catch, and burn fuel.
- `vote_hold` — vote on whether to hold an ostracism.
- `write_shard` — name up to three accounts for ostracism.
- `contribute_reseed` — burn TIDE toward a funded reseed.
- `tick` — settle elapsed seasons and assemblies.

The full interface is in `contract/src/lib.rs` and the generated ABI at `contract/target/near/tide_abi.json`.

## Honest limits

- An exiled owner can build a freshly funded boat from another account; it costs 1% and requires fresh capital.
- Seasons settle lazily, at most 40 per call; the page blocks actions above 40 unsettled seasons. The keeper is a convenience process, and anyone can call `tick`.
- Views project unsettled seasons but do not replay assemblies; call `tick` to settle an assembly on chain.
- On-chain randomness is not used. The live page supports wallet actions, while the CLI remains useful for independent inspection.
- The faucet is testnet-only and exists only on deployments initialized with a nonzero amount.
- The sponsor can run out of testnet NEAR; onboarding refuses to operate below 1 NEAR and is limited to once per account per day, five accounts per client IP per day, and the configured daily cap.
- MetaMask players confirm every action, and the dev signer is localhost-only.

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
