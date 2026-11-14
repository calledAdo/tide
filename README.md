# $TIDE

A NEP-141 memecoin whose unminted supply is a living fish stock. Holders fish it into existence, can fish it to extinction, and police each other on chain.

[Live app](https://tidenear.astromind.cc) | Tracks: `memecoins`, `games` | Licence: MIT | Network: testnet

## What it is

The sea is unminted TIDE supply, held in the contract as a fish population. It has a carrying capacity, the most fish it can hold, and a stock, the fish in it right now. Each season the stock regrows toward that ceiling - but below a critical density, the Allee threshold, growth turns negative and the population cannot recover even if every boat stops.

A holder stakes TIDE as a boat and chooses its effort: how hard it fishes. Catch is minted to the boat; fuel is burned from its balance and paid to nobody. Each boat may take a fair share of the season's quota, its stake-proportional slice. Taking more is allowed, and recorded on chain as a public indictment naming the boat, its catch, and its excess. Nobody stops you; everybody knows.

Every third season the fleet holds an assembly and can exile a boat for ten seasons. An exiled boat keeps every token it owns - it simply cannot fish.

## Play it

[Open the live app](https://tidenear.astromind.cc).

1. Connect MetaMask and let the app create or resume a NEAR eth-implicit account.
2. Claim the one-time 100,000 TIDE testnet faucet.
3. Launch a boat by staking at least 1,000 TIDE.
4. Choose effort to fish once per season, and vote or write a shard during an assembly.

[Replay the sea without a wallet](https://tidenear.astromind.cc/#/replay).

[Watch the two-minute demo](https://x.com/Sylvexta/status/2121704720095949063).

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
3. Effort is 1 to 10,000 basis points. Catch is proportional to stake, effort, and the boat's share of the fleet; the whole fleet at full effort can take at most 25% of the opening stock. Fuel burned is `0.002 * stake * effort`, so a boat at full effort burns `0.002 * stake`.
   *Why:* effort costs something, so fishing harder is a real trade-off rather than a free choice. This is the cost side of Gordon's model; without it, maximum effort is always rational.
4. A boat's fair share is `quota * stake / fleet`, where the quota is 80% of the sea's maximum sustainable yield, computed from its current capacity. In generation 0 of this deployment, that is 58,524 fish from a 73,155-fish MSY; both are derived values, not fixed limits. Catch above fair share is permitted but recorded as a public indictment for that assembly.
   *Why:* the contract could simply refuse an oversized catch. It does not, because Ostrom's point is that a commons survives when the users monitor and sanction each other. Hard-coding the limit would answer Hardin's question by force and would prove nothing about a community.
5. Every third season is an assembly. In stage 1, eligible boats vote whether to hold an ostracism; yes must be more than half of eligible boats. In stage 2, each eligible boat writes one to three NEAR account names on a shard.
   *Why:* Athens asked first whether to hold an ostracism at all, and only then took names. One-stage voting is capturable: in 417 BC Nicias and Alcibiades combined their followers to exile Hyperbolus, and Athens never held another ostracism. The simulation reproduces exactly that failure and shows the two-stage rule blocking it.
6. A name written by at least 40% of eligible boats is exiled when the season closes. Exile lasts 10 seasons and blocks fishing, unstaking, transfers, and voting; the boat's TIDE is not confiscated. Its stake remains in the fleet denominator, so its unused quota share stays in the sea.
   *Why:* a sanction that confiscated would be theft and would invite factional voting for profit. Leaving the share unfished means banishing a rival earns you nothing directly, which removes the motive the naive rules create.
7. THE RECKONING begins when a season closes below the Allee threshold. A wreck burns half of every boat's stake and returns half to its wallet. This collective liability is part of the rule: it makes pulling back rational for a dominant overfisher as well as for the rest of the fleet.
   *Why:* a terminal death makes the game finite, and finitely repeated commons games unravel from the end backwards (the Folk Theorem's converse), so the old rule rewarded the final raid. Clark (1973) showed extinction can be privately rational whenever a stock grows more slowly than the return on liquidating it. A raider's wreck loss is hundreds of times its final grab - 265x at full stock, 618x at 300,000 fish, 1,545x at the line - so the ratio worsens for the raider exactly as the sea approaches collapse. [CONSTANTS.md](CONSTANTS.md) has the trace.
8. During a wreck, contributors can permanently burn 1,000,000 TIDE to fund a reseed within 60 seasons. A funded reseed starts at 70% of the new capacity; capacity falls 20% per generation while `A` stays at 120,000. If it is not funded, the sea returns through the poor fallback at the larger of 240,000 fish or 30% of new capacity, then burns half of every catch for 30 recovery seasons.
   *Why:* the sea must come back or the horizon stays finite, but it must come back worse or collapse costs nothing. Ecologists call the permanent shift a regime shift; the capacity ratchets down 20% a generation while the point of no return does not move, so the safe band narrows every time and the community can still lose the game for good.
9. There is no owner, administrator, parameter setter, or cron dependency. Any state-changing call, including `tick`, settles up to 40 elapsed seasons, and deployment deletes every access key from the contract account.
   *Why:* the contract's game rules are fixed after deployment; only the three deployment values below vary.

### The numbers

Every rule above is a compile-time constant; the contract has no setters and no access keys, so none of
them can change on a live sea. Only three values are chosen at deployment: the genesis accounts, the
season length, and the faucet amount.

Capacity, maximum sustainable yield, quota, and fair share are not stored limits - the contract derives
them from the sea's current carrying capacity, so they fall together after every wreck.

The full tables - fixed constants, this deployment's three values, and the derived figures per
generation - are in [CONSTANTS.md](CONSTANTS.md).

## Why these parameters

Every parameter was chosen from simulations that ship in the repo and can be re-run with one command.
Three models, in `sim/`:

- **Governance** (`sim/tide_sim.py`). At 10% staked, open access drives the stock to 78 fish and nine
  seasons below the line; the same crowd under TIDE's rules ends at 931,909 fish with 50 exiles and no
  wrongful ones. At 50% staked, governance returns +21.4% fisher APR against +2.0% for open access.
  The model also reproduces the Hyperbolus failure: naive one-stage voting gives a 30% faction a 3.44x
  edge to exile whoever it likes, and the two-stage rule removes it.
- **Supply** (`sim/tide_supply.py`). Fuel burn makes quota-keeping net inflation fall from +17.0% a
  year at 20% staked to +3.0% at 90% staked. Greedy fishing produces far less fisher APR and less
  surviving stock.
- **The reckoning** (`sim/tide_reckoning.py`). A raider's wreck loss against its final grab: 265x at
  full stock, 618x at 300,000 fish, 1,545x at the line. The ratio rises as the stock falls, so the
  rational endgame shifts from grabbing to pulling back.

Full output tables are in [CONSTANTS.md](CONSTANTS.md).

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
