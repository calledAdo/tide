# TIDE testnet service

This Node 22 service provides two small operational functions for the TIDE testnet:

- `POST /testnet/onboard` funds an eth-implicit NEAR account up to the configured NEAR amount and registers it with the TIDE contract.
- The keeper periodically views `get_sea()` and sends `tick({})` when seasons are more than `KEEPER_MIN_BEHIND` behind, up to five ticks per run. The default threshold is 30.
- The event indexer backfills and follows TIDE transactions through FastNEAR, persisting `events.jsonl` and processed transaction hashes in `DATA_DIR`.

The current demo contract is `sea-1794591365.tide-sponsor-53394.testnet`. The previous `tide-1794517191.memethis-t40-demo.testnet` contract is a dead exhibit and must not be configured for the bots.

## Bot captains

The six disclosed demo accounts run as ordinary bot captains. A captain without a boat stakes 9,900,000 TIDE once, then waits for the contract's top-up season to pass. Each season `ana`, `ben`, `cy`, and `eve` fish 60% of their own fair share, while `dee` fishes 40%. `greedy` fishes at full effort only on even cycles and can be indicted and exiled.

Below 400,000 `stock_fish` is the bot-only floor. All bots, including `greedy`, stop fishing and stay stopped until stock is above 500,000. Human players are never limited by this bot policy. They have no contract privilege; each uses a function-call key restricted to `stake`, `unstake`, `fish`, `vote_hold`, `write_shard`, and `tick`, with a 0.25 NEAR allowance and no ability to transfer funds. The service reads those keys from `BOT_KEYS_FILE` and never logs them. Set `BOTS_ENABLED=false` to disable the captains.

The service listens on `127.0.0.1:3101` by default and is intended to sit behind Caddy. It uses only `near-api-js` and Node built-ins. The sponsor private key is used only in memory and is never logged.

## Endpoints

`GET /health` returns the testnet, TIDE contract, sponsor, sponsor balance, seasons behind, `keeperMinBehind`, keeper state, bot summary, today’s onboarding count, and the indexer gap. `GET /indexer/status` also reports processed hashes, the FastNEAR transaction count, gap, and the last full sweep time.

`GET /bots/status` returns the latest `stock`, `floorActive` state, and each bot's role, target fraction, latest effort in basis points, latest stake and fishing transactions, latest vote and shard cycles, exile season, and last error.

`POST /testnet/onboard` accepts JSON such as `{"accountId":"0x..."}`. The account must match `0x` plus 40 lowercase hexadecimal characters. A successful response contains the funded account, target NEAR amount, registration status, and transaction hashes. Requests are limited to one funding per account per 24 hours, five accounts per client IP per 24 hours, and the configured daily total. The limiter is persisted in `DATA_DIR`.

The indexer endpoints are `GET /indexer/status`, `GET /events`, `GET /boat/:account/history`, `GET /assemblies`, and `GET /leaderboard?by=catch|net|indictments`. They return JSON with `cache-control: no-store`.

Only origins in `FRONTEND_ORIGINS` receive CORS headers. The service accepts JSON POST requests and GET health requests, with a 2 KB request body limit.

## Environment

Required variables:

```text
TIDE_CONTRACT=sea-1794591365.tide-sponsor-53394.testnet
SPONSOR_ACCOUNT_ID
SPONSOR_PRIVATE_KEY
FRONTEND_ORIGINS
```

`SPONSOR_PRIVATE_KEY` must be the sponsor’s `ed25519:...` NEAR secret key. Other variables and defaults are:

| Variable | Default |
| --- | --- |
| `PORT` | `3101` |
| `HOST` | `127.0.0.1` |
| `RPC_URL` | `https://test.rpc.fastnear.com` |
| `DATA_DIR` | `/var/lib/tide` |
| `ONBOARD_NEAR` | `0.5` |
| `ONBOARD_MIN_NEAR` | `0.1` |
| `ONBOARD_DAILY_CAP` | `60` |
| `KEEPER_INTERVAL_MS` | `30000` |
| `KEEPER_MIN_BEHIND` | `30` |
| `KEEPER_ENABLED` | `true` |
| `BOTS_ENABLED` | `true` |
| `BOTS_INTERVAL_MS` | `20000` |
| `BOT_KEYS_FILE` | `/etc/tide/bot-keys.json` |
| `INDEXER_ENABLED` | `true` |
| `FASTNEAR_TX_URL` | `https://tx.test.fastnear.com` |
| `INDEXER_POLL_MS` | `10000` |
| `INDEXER_SWEEP_MS` | `300000` |

## Local checks

```sh
cd server
npm ci --omit=dev
npm test
for file in src/*.js; do node --check "$file"; done
```

## Deploy

1. Create a dedicated service user and directories on the VPS:

   ```sh
   sudo useradd --system --home /nonexistent --shell /usr/sbin/nologin tide
   sudo install -d -o tide -g tide -m 0750 /opt/tide/server /var/lib/tide /etc/tide
   ```

2. From the repository checkout, copy only this service to the VPS:

   ```sh
   rsync -a --delete server/ VPS:/opt/tide/server/
   ```

3. Install production dependencies:

   ```sh
   ssh VPS 'cd /opt/tide/server && npm ci --omit=dev'
   ```

4. Create `/etc/tide/tide-api.env` with the variables from `deploy/env.example`. Set `DATA_DIR=/var/lib/tide` and the configured `TIDE_CONTRACT` (the current demo value is `sea-1794591365.tide-sponsor-53394.testnet`), sponsor, key, and frontend origins. Do not use the dead `tide-1794517191.memethis-t40-demo.testnet` exhibit. Then protect it:

   ```sh
   sudo chown root:root /etc/tide/tide-api.env
   sudo chmod 600 /etc/tide/tide-api.env
   ```

5. Install and enable the systemd unit:

   ```sh
   sudo cp /opt/tide/server/deploy/tide-api.service /etc/systemd/system/tide-api.service
   sudo systemctl daemon-reload
   sudo systemctl enable --now tide-api
   sudo systemctl status tide-api
   ```

6. Append the separate `deploy/Caddyfile.tide` site block to the existing Caddy configuration. Do not replace or edit another site block. Validate and reload:

   ```sh
   sudo caddy validate --config /etc/caddy/Caddyfile
   sudo systemctl reload caddy
   ```

7. Verify locally and through the public hostname:

   ```sh
   curl http://127.0.0.1:3101/health
   curl https://tide.204-48-27-245.sslip.io/health
   ```
