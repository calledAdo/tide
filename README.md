# $TIDE

A NEP-141 memecoin whose supply is a living fish stock: holders fish it into existence, can fish it to extinction, and police each other by Athenian ostracism.

Playable testnet page: https://tide-near.vercel.app/
Replay: https://tide-near.vercel.app/?demo

Track: `memecoins` (NEAR Hackathon 2026). License: MIT. Status: testnet; contract keyless after deployment.

## Try it in 2 minutes

### Play it

1. Open the [playable testnet page](https://tide-near.vercel.app/?contract=tide-1794517191.memethis-t40-demo.testnet).
2. Connect a NEAR testnet wallet, then register and claim the one-time 100,000 TIDE faucet.
3. Build a boat with at least 1,000 TIDE. The 1% build burn applies and fishing starts next season.
4. Optionally enable one-tap signing, then set effort, preview your catch, and fish once per season.
5. During an assembly, vote in the hold stage or write up to three shards in the shards stage.
6. Use TICK to settle elapsed seasons when the contract is behind its clock.

### Replay without a wallet

1. Run `./scripts/check.sh` -> see the two model tables, contract tests, the web simulation check, and `ALL CHECKS PASSED`.
2. Open https://tide-near.vercel.app?demo or open `web/index.html?demo` locally to see replay mode. Pick `Lawless sea` ->
   the 10%-staked open-access run crosses the Allee threshold
   on day 9 and ends at 78 fish. Pick `$TIDE` -> the same crowd survives at 931,909 fish, with 50 exiles and
   0 wrongful exiles. Use `web/index.html?contract=<id>` for a different playable contract.
3. To use a real testnet instance, follow the deployment steps below.

### Testing the playable app locally

Serve `web/` from localhost so the browser can load the live wallet module:

```bash
python3 -m http.server 8080 --directory web
```

The dev-only hook is active only on `localhost` and `127.0.0.1`. A test harness can set a connected
account and its already-authorized one-tap secret in that browser's local storage:

```js
localStorage.setItem('tide-dev-account', '<account>');
localStorage.setItem('tide-chip-key:<account>', '<ed25519-secret-key>');
```

The secret must correspond to a function-call key on the contract account, and is never stored in this
repository. Fishing, voting, shards, staking, unstaking, and tick can then be tested without wallet popups.
Registration, the faucet, and enabling one-tap remain wallet-only actions in dev mode.

## Live on testnet

The deployed testnet contract is `tide-1794517191.memethis-t40-demo.testnet`. Watch it in the [NEARBlocks explorer](https://testnet.nearblocks.io/address/tide-1794517191.memethis-t40-demo.testnet).

It has **no access keys**. Verify with:

```bash
near account list-keys tide-1794517191.memethis-t40-demo.testnet network-config testnet now
```

Seasons are 60 seconds. It was deployed from the author's existing testnet account `memethis-t40-demo.testnet` with six demo boats: `ana-`, `ben-`, `cy-`, `dee-`, `eve-`, and `greedy-1794517191.memethis-t40-demo.testnet`.

What already happened on chain, from `scripts/demo.sh`:

- Season 18: six boats staked.
- Season 19: five boats fished their fair share; greedy fished at full effort and was indicted.
- Season 20: the assembly voted 5-1 to hold an ostracism, and three shards named greedy.
- Season 21: greedy was exiled. Its `fish` and `ft_transfer` calls failed with `Smart contract panicked: EXILED until season 31`.

Seasons keep running after the demo, so by the time you read this the exile has ended and greedy is back at sea (exile is temporary by design). The record stays on chain: the `indicted`, `assembly_closed` and `exiled` events are in the contract's transaction history in the explorer.

To watch it, open `web/index.html?contract=tide-1794517191.memethis-t40-demo.testnet`, or click Live; `web/config.js` already points at it. History is kept in your browser and grows one point per season.

The public RPC rate-limits bursts of view calls; `demo.sh` retries its polling automatically.

## The mechanic

1. The sea is unminted supply `S`. It starts at 700,000 fish and grows once per season under `g(S) = r * S * (1 - S/K) * (S - A) / K`. Below the Allee threshold `A`, growth is negative and the stock moves toward extinction.
2. Holders stake TIDE as boats. A boat built or topped up in season `s` can first fish in `s + 1`. Catch uses the opening stock and the opening fleet snapshot, so transaction order within a season does not change catch.
3. Fishing burns fuel: `FUEL * stake * effort`, where full effort is 10,000 basis points. The whole fleet at full effort can take at most 25% of the opening stock.
4. A boat's fair share is `quota * stake / fleet`. The quota is 80% of maximum sustainable yield. The quota is not enforced: a boat may fish harder, but catch above fair share is recorded as a public indictment for that assembly cycle.
5. Every third season is an assembly. In stage 1, eligible boats answer whether to hold an ostracism. It passes only when yes votes are more than half of eligible boats.
6. In stage 2, each eligible boat writes one to three NEAR account names on a shard. A name written by at least 40% of eligible boats is exiled when the season closes.
7. Exile lasts 10 seasons. The exiled boat cannot fish, unstake, transfer, or vote. Its TIDE is not confiscated.
8. An exiled boat's stake remains in the fleet denominator, so its unused quota share stays in the sea rather than being redistributed to the boats that named it.
9. There is no owner, administrator, parameter setter, or cron job. Any call or `tick` settles elapsed seasons, up to 40 per call. Deployment deletes every access key from the contract account.

The values below are compile-time constants from `contract/src/sea.rs`; the contract has no setter.

| Constant | Value | Meaning |
| --- | ---: | --- |
| `DECIMALS` | 18 | TIDE decimal places |
| `ONE` | `10^18` | One TIDE in token units |
| `MICRO` | `10^6` | Micro-fish precision |
| `UNITS_PER_MICRO` | `10^12` | Token units per micro-fish |
| `BPS`, `PPM` | 10,000; 1,000,000 | Basis-point and parts-per-million scales |
| `K_FISH` | 1,000,000 | Carrying capacity `K` |
| `A_FISH` | 120,000 | Allee threshold `A` |
| `R_BPS` | 6,000 (`r = 0.6`) | Growth rate |
| `INITIAL_STOCK_FISH` | 700,000 | Initial unminted stock |
| `MAX_TAKE_BPS` | 2,500 | Fleet full-effort cap: 25% of stock |
| `FUEL_PPM` | 2,000 | Fuel: 0.002 per staked token at full effort |
| `QUOTA_FISH` | 58,524 | Quota fish per season, 80% of MSY |
| `MIN_STAKE` | 1,000 TIDE | Minimum stake to vote |
| `BUILD_BURN_BPS` | 100 | 1% of each stake deposit |
| `ASSEMBLY_EVERY` | 3 seasons | Assembly cadence |
| `EXILE_SEASONS` | 10 | Exile duration |
| `NAMES_PER_SHARD` | 3 | Maximum names per shard |
| `QUORUM_BPS` | 4,000 | 40% of eligible boats |
| `SHARD_BURN` | 1 TIDE | Burn per name written |
| `MAX_CATCHUP` | 40 seasons | Maximum settlement per call |

## Why these parameters: the simulation

`python3 sim/tide_sim.py` prints:

```text
MSY stock 689,000  MSY/season 73,155  quota 58,524
scenario                                                   final stock below Allee@ fisher APR exiles wrong faction edge
10% staked: open access (5 greedy, 15 cond. coop.)                  78            9     +20.6%      0     0
10% staked: TIDE, same crowd + ostracism                       931,909         None    +178.7%     50     0             
50% staked: open access (5 greedy, 15 cond. coop.)             435,206         None      +2.0%      0     0             
50% staked: TIDE, same crowd + ostracism                       931,909         None     +21.4%     50     0             
50% staked: benchmark, everyone keeps quota                    896,332         None     +23.3%      0     0             
50%: 30% faction, NAIVE rules (1-stage, redistribute)          896,332         None     +23.3%    120   120        3.44x
50%: 30% faction, TIDE rules (2-stage, share to sea)           896,332         None     +23.3%      0     0        1.00x
10% staked: all greedy + ostracism (no honest majority)             37            8     +18.9%      0     0
```

`python3 sim/tide_supply.py` prints:

```text
genesis 100,000,000  quota/season 58,524  (21.4%/yr gross if fully fished)
 staked behaviour  net supply 1y  fisher APR       minted       burned  stock end  dead@
    20%     quota         +17.0%      +79.5%   21,361,216    4,356,932    896,332   None
    20%    greedy          +0.3%       +2.3%    1,019,056      760,940    122,949   None
    50%     quota         +10.8%      +21.5%   21,361,216   10,583,594    896,332   None
    50%    greedy          +0.1%       +1.3%   11,511,469   11,386,093    428,048   None
    70%     quota          +6.8%      +10.4%   21,361,216   14,538,095    896,332   None
    70%    greedy          +0.3%       +1.5%   19,914,297   19,567,554    594,720   None
    90%     quota          +3.0%       +4.3%   21,361,216   18,342,365    896,332   None
    90%    greedy          +0.3%       +1.4%   25,476,019   25,130,674    645,389   None
```

- Lawless fishing at 10% staked crosses the point of no return on day 9; the governed run survives with 50 exiles and 0 wrongful ones.
- At 50% staked, the governance run pays +21.4% APR versus +2.0% for lawless fishing. The separate one-year supply model rounds its quota row to +21.5%.
- The naive one-stage, share-redistribution rules let a 30% faction exile 120 honest boats and earn 3.44x. The two-stage vote blocks a minority faction, while returning the share to the sea removes the direct profit from a majority faction.
- The all-greedy case is the honest limit: no institution saves a community with no honest majority.
- The first design, one exile per 5 seasons, collapsed in simulation because one punishment could not keep up with five cheaters. Ballots therefore carry up to 3 names and assemblies meet every 3 seasons.

The model is a re-runnable design input, not a price forecast. It uses the v2 fleet cap and fuel burn; the governance model and supply model are separate experiments with the same sea constants.

## Tokenomics

TIDE is minted as catch when `fish` is called, at genesis balances during initialization, and by the fixed testnet faucet when a deployment sets a nonzero faucet amount. The catch is accounted against the sea when its season closes. TIDE is burned as fishing fuel, as 1% of a stake deposit when a boat is built, and as 1 TIDE per name written on a shard. Exile burns and confiscates nothing.

Inflation falls as staking rises because fuel burn rises with fleet size: in the one-year supply table, quota-keeping net supply change falls from +17.0% at 20% staked to +3.0% at 90%. Unstaked holders are diluted by catch in the same basic way that non-staking NEAR holders are diluted by staking issuance. No price is promised.

## Deploy your own (testnet)

Prerequisites are Rust, `cargo-near`, near-cli-rs 0.31, and a funded testnet account whose key is in the legacy keychain. Run:

```bash
MASTER=you.testnet ./scripts/deploy-testnet.sh
./scripts/demo.sh
```

The default funding is `CONTRACT_FUND="3.5 NEAR"` for the contract and `BOAT_FUND="0.5 NEAR"` for each of the six demo accounts, for a total of approximately 6.5 NEAR before gas. Set either variable when running the deploy script if your account needs a different allocation.

The deploy script builds `contract/target/near/tide.wasm`, creates and seeds the contract plus six demo accounts, initializes the contract, deletes all contract access keys, writes `web/config.js`, and writes `scripts/.env.demo`. Open `web/index.html?contract=<id>` for live mode. `DRY_RUN=1 MASTER=example.testnet ./scripts/deploy-testnet.sh` prints the build and transaction commands without requiring an account or network. `DRY_RUN=1 ./scripts/demo.sh` also prints its sequence and uses placeholder account IDs when `.env.demo` is absent.

## Contract interface

| Method | Type | Purpose |
| --- | --- | --- |
| `new(genesis, season_len_sec, faucet_amount)` | change/init | Initialize balances, clock, sea, and optional faucet. |
| `tick()` | change | Settle elapsed seasons and assemblies. |
| `stake(amount)` | change | Build or top up a boat; burns 1% and starts next season. |
| `unstake(amount)` | change | Return staked TIDE unless exile or an open indictment blocks it. |
| `fish(effort_bps)` | change | Mint catch and burn fuel for one fishing trip. |
| `vote_hold(yes)` | change | Cast the stage 1 assembly vote. |
| `write_shard(names)` | change | Write up to three account names in stage 2 and burn 1 TIDE/name. |
| `claim_faucet()` | change | Claim the deployment's faucet amount once. |
| `get_params()` | view | Return fixed constants and deployment settings. |
| `get_sea()` | view | Return projected stock, season, assembly stage, supply, and totals. |
| `get_boat(account_id)` | view | Return boat state, fair share, full catch, fuel, and exile status. |
| `get_assembly()` | view | Return current ballots, shards, quorum, and last result. |
| `get_indictments(cycle)` | view | Return account names and overage for a cycle. |
| `get_exiles()` | view | Return exiled account names and release seasons. |
| `ft_transfer(receiver_id, amount, memo)` | change | NEP-141 transfer; exiled senders are blocked. |
| `ft_transfer_call(receiver_id, amount, memo, msg)` | change | NEP-141 transfer-and-call; exiled senders are blocked. |
| `ft_total_supply()` | view | Return total TIDE supply. |
| `ft_balance_of(account_id)` | view | Return an account's TIDE balance. |
| `storage_deposit(account_id, registration_only)` | payable change | Register an account for NEP-141 storage. |
| `storage_withdraw(amount)` | payable change | Withdraw available storage balance. |
| `storage_unregister(force)` | payable change | Unregister an account with no staked boat. |
| `storage_balance_bounds()` | view | Return the NEP-145 storage bounds. |
| `storage_balance_of(account_id)` | view | Return an account's storage balance. |
| `ft_metadata()` | view | Return TIDE's NEP-148 metadata. |
| `ft_resolve_transfer(...)` | private callback | Resolve `ft_transfer_call`; callable only by the contract runtime. |

## Honest limits

- Voting is one vote per boat, with a minimum stake of 1,000 TIDE and a one-season age requirement. A whale that splits early across accounts gains votes.
- With no honest majority, there is no rescue.
- A freshly funded new boat can still be built by an exiled owner from another account. It costs 1% and requires fresh capital.
- Seasons settle lazily, at most 40 per call; the page blocks actions only when more than 40 seasons are
  unsettled. A keeper may call `tick` periodically to keep the sea current; anyone can call `tick`.
- Views project unsettled seasons but do not replay assemblies. Call `tick` to settle an assembly on chain.
- On-chain randomness is not used anywhere.
- The live page supports wallet actions; the CLI remains useful for independent contract inspection.
- The testnet faucet exists only on deployments initialized with a nonzero faucet amount.
- Nothing is audited.

## Why NEAR

NEAR account names make a shard readable: `write_shard(["greedy.near"])` names a person-sized account rather than a hex address. The contract can be keyless after deployment, and per-season transactions are inexpensive enough for the ritual. TIDE uses NEP-141 and emits NEP-297-style event records for each mint, burn, indictment, and exile.

## Research behind it

Gordon (1954); Schaefer (1954); Hardin (1968); Ostrom (1990); Fehr & Gachter (2000); Levhari & Mirman (1980); Forsdyke (2005), including ostracism and Hyperbolus in 417 BC.

## Built with

near-sdk 5.30.1, near-contract-standards, cargo-near, and near-cli-rs.

Big Shoulders Display, Inter Tight, and JetBrains Mono, bundled locally under `web/fonts/` and licensed under the SIL Open Font License 1.1. The page's visual style is an editorial/brutalist theme shared with the author's other NEAR app. Briefs 01-07 are in `briefs/`.

Design, simulation and specs by the author with Claude Code; implementation tasks delegated to OpenAI Codex (gpt-5.6-luna) from written briefs in `briefs/`, reviewed and tested by the author. All code was written during the hackathon (from 2026-11-12).

## Repository layout

```text
.
├── .gitignore # Ignore rules
├── LICENSE # MIT license
├── README.md # Project overview and usage
├── briefs/ # Design and implementation briefs
│   ├── 01-fix-test-and-build.md # Initial build and test brief
│   ├── 01b-abi-schema.md # ABI schema brief
│   ├── 02-web-page.md # Web page brief
│   ├── 03-readme-and-scripts.md # README and scripts brief
│   ├── 04-review-fixes.md # Review fixes brief
│   ├── 05-readable-web.md # Readable web brief
│   ├── 05b-refactor-regressions.md # Regression refactor brief
│   ├── 06-restyle-editorial.md # Editorial restyle brief
│   └── 07-repo-metadata.md # Repository metadata brief
├── contract/ # NEAR smart contract
│   ├── Cargo.lock # Locked Rust dependencies
│   ├── Cargo.toml # Rust package metadata
│   └── src/ # Contract source and tests
│       ├── lib.rs # Contract: NEP-141, seasons, fishing, indictments, assembly, exile
│       ├── sea.rs # Fixed parameters and the pure sea math (growth, catch, fuel, fair share)
│       └── tests.rs # Contract tests
├── scripts/ # Build, check, and deployment scripts
│   ├── check.sh # Run project checks
│   ├── demo.sh # Run the demo sequence
│   └── deploy-testnet.sh # Deploy to NEAR testnet
├── sim/ # Supply and fishery simulations
│   ├── tide_runs.csv # Simulation run data
│   ├── tide_sim.py # Governance simulation
│   ├── tide_stock.png # Stock chart raster
│   ├── tide_stock.svg # Stock chart vector
│   └── tide_supply.py # Supply simulation
└── web/ # Browser demo and live page
    ├── app.js # Page interaction logic
    ├── check-sim.cjs # Browser simulation check
    ├── config.js # Deployment configuration
    ├── fonts/ # Bundled local fonts
    │   ├── README.md # Font inventory and license
    │   └── *.woff2 # Big Shoulders Display, Inter Tight, JetBrains Mono (OFL 1.1), see web/fonts/README.md
    ├── index.html # Page markup
    ├── sim.js # Browser simulation
    └── styles.css # Page styles
```
