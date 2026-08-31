# Ruby — Bitcoin analytics MCP

Paywalled MCP tools that compose Bitcoin-only data from the
[Twenty-One Million halving API](https://why21million.com/halving-api/),
[mempool.space REST](https://mempool.space/docs/api/rest), and
[btcnode.uk](https://btcnode.uk/). Billing goes through `SolvaPay.create` and
`SolvaPay::Mcp.register_payable_tool`.

**Not financial advice.** Tools return protocol facts (height, fees, subsidy,
mempool, address/tx) with source attribution.

## Tools

Each call bills 1 unit of the `requests` meter on `SOLVAPAY_PRODUCT`. Upstream
fan-out is not extra-billed.

| Tool                  | Sources                                                                                                 | Returns                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `network_snapshot`    | btcnode `/api/info`, mempool tip height/hash + difficulty-adjustment, why21million `/api/halving/{tip}` | Tip from both nodes, signed `heightDelta`, SI-scaled difficulty, retarget ETA, era and subsidy           |
| `halving_outlook`     | mempool tip (or optional `height`), why21million                                                        | Era, `rewardBtc`, blocks until next halving, era progress / 210,000, estimate labelled "at 10 min/block" |
| `fee_outlook`         | mempool recommended + precise + mempool-blocks, btcnode `/api/fees` + `/api/fees/predict`               | Unified sat/vB bands; sub-1 rates via `precise`; next-block projection                                   |
| `mempool_health`      | mempool `/api/mempool` + `/recent`, btcnode `/api/mempool`                                              | Both backlogs with distinct units, signed `pendingTxDelta`, recent tx sample. `fee_histogram` dropped    |
| `address_brief`       | mempool `/api/address/:addr` only                                                                       | Confirmed balance, mempool delta, UTXO count. Notes that btcnode addr is unavailable                     |
| `tx_brief`            | mempool tx + status + tip, btcnode `/api/tx/:hash`, optional `/api/trace/:txid`                         | Derived vsize/fee rate, confirmations cross-check, capped 2-hop trace in sats                            |
| `miner_revenue_split` | why21million + mempool-blocks + tip                                                                     | Next-block subsidy vs fees and fee share of miner revenue                                                |

Optional `height` on `halving_outlook` only. Optional `trace` on `tx_brief`.

## Live-probe findings

These were observed against the public APIs and are why the example is shaped
this way:

1. **btcnode `/api/whales` returns HTTP 402**, not free. The homepage advertises
   it as free; the live response is x402. This example does not implement that
   handshake. `miner_revenue_split` replaces a whale watcher.
2. **btcnode `/api/addr/:address` is broken**: HTTP 200 with
   `{"success": false, "error": "Multiple wallets are loaded..."}`.
   `address_brief` is mempool.space-only.
3. **btcnode signals failure with HTTP 200 + `success: false`.** Status-code-only
   handling would treat an error object as data. Clients raise on both.
4. **mempool.space `/api/v1/difficulty-adjustment` mixes time units.**
   `remainingTime` / `timeAvg` / `estimatedRetargetDate` are milliseconds;
   `previousTime` is a **second** epoch. The published doc example shows
   `estimatedRetargetDate` in seconds; live returns a millisecond epoch.

Also: tip height and tip hash are **bare text**, not JSON.
`/api/v1/fees/recommended` floors at 1 sat/vB; `/api/v1/fees/precise` is
required for sub-1 rates.

## Unit reference

Every number below was observed live. `format.rb` and this table exist so each
field keeps an explicit unit.

### mempool.space — satoshis, vBytes, mixed time units

- `GET /api/blocks/tip/height` — bare text integer. Parse with `Integer(body.strip)`.
- `GET /api/blocks/tip/hash` — bare text hex string.
- `GET /api/v1/difficulty-adjustment`
  - `progressPercent`, `difficultyChange`, `previousRetarget` — percent floats. Signed change: `+0.43%`, `-1.31%`.
  - `remainingBlocks` / `expectedBlocks` — blocks.
  - `remainingTime`, `timeAvg`, `adjustedTimeAvg` — **milliseconds**.
  - `estimatedRetargetDate` — **millisecond** epoch.
  - `previousTime` — **second** epoch. Different unit, same object.
  - `nextRetargetHeight` — height.
- `GET /api/v1/fees/recommended` — sat/vB integers, floored at 1.
- `GET /api/v1/fees/precise` — sat/vB to 3 decimals, down to 0.1.
- `GET /api/v1/fees/mempool-blocks` — `blockSize` bytes, `blockVSize` vBytes, `totalFees` satoshis, `medianFee` sat/vB.
- `GET /api/mempool` — `vsize` vBytes, `total_fee` satoshis. `fee_histogram` is omitted from fixtures and responses.
- `GET /api/mempool/recent` — `fee` / `value` satoshis, `vsize` vBytes.
- `GET /api/address/:address` — sums in satoshis. Confirmed balance =
  `funded_txo_sum - spent_txo_sum`. Do not call `/utxo` (HTTP 400 above 500 UTXOs).
- `GET /api/tx/:txid` — `fee` satoshis, `size` bytes, `weight` weight units. No `vsize`; derive `weight / 4.0`.
- `GET /api/tx/:txid/status` — `block_time` is a **second** epoch.
- HTTP 429 is not retried away.

### why21million — BTC floats

`GET /api/halving/{height}` → `era` (1-indexed), `rewardBtc` (BTC float),
`blocksIntoEra` (0-indexed), `blocksUntilNextHalving`, `nextHalvingBlock`.
Era length is 210,000. Height `6930000` → era 34 / `rewardBtc: 0` (issuance
ended — render as `0 BTC, issuance ended`). Invalid height → HTTP 400.

### btcnode.uk — inconsistent types, HTTP 200 on failure

- `/api/info` — `difficulty` is a **string**.
- `/api/mempool` — `mempool_mb` is a **string** of serialized megabytes, not vBytes.
- `/api/tx/:hash` — `block_height` can be `null` on a confirmed tx. Never render that as `0`.
- `/api/trace/:txid` — input `value` is a BTC float; this example converts to sats and caps depth at 2 hops.
- Not called: `/api/reddit/*`, scrape, summarize, systems/game/omni-theory, `/api/sec/insider/*`, taint/agent address endpoints, `/api/whales`, `/api/agent/whales`, `/api/addr/:address`.

### Mempool comparison is not a size delta

btcnode `pending_tx` / `mempool_mb` and mempool.space `count` / `vsize` differ
because the nodes have different policies **and** because MB-of-serialized-bytes
is not vBytes. The tools emit both, labelled. `pendingTxDelta` is a count.
Sizes are never subtracted.

## Output contract

Each tool returns unit-suffixed machine keys, a sibling `display` hash of
preformatted strings, `sources`, and `notes`. Narration goes in `ctx.respond`
as `{ "text" => ... }`.

Formatting rules:

- BTC from satoshis uses integer `divmod` only — never `sats / 1e8`.
- On-chain amounts always show both denominations: `150.07688098 BTC (15,007,688,098 sat)`.
- Fee rates: 3 decimals below 1 sat/vB, 2 at or above, trailing zeros stripped.
- Percentages: 2 decimals; explicit sign for change fields.
- Durations: millisecond inputs divided by 1000 first, two largest non-zero units.
- Epochs: ISO 8601 UTC from the correct base (ms vs seconds).
- Difficulty: parse the string, SI-scale (`125.81 T`), keep `difficultyRaw`.
- Sizes: vBytes as `MvB`, btcnode megabytes as `MB`.
- Nulls stay null; display reads `not reported`.

`format.rb` exposes `assert_duration_ms!`, `assert_epoch_ms!`, and
`assert_epoch_seconds!` so a unit flip fails loudly instead of being sniffed
from magnitude.

If an upstream endpoint times out or never answers, the tool still returns
whatever other sources did fetch. Missing fields stay `null` / `not reported`,
and the narration plus `notes` name the exact host and path that could not be
reached. Live HTTP uses a 5s connect timeout and an 8s read timeout.

## Modes

| Mode         | Command                                           | SolvaPay                           | Upstream  |
| ------------ | ------------------------------------------------- | ---------------------------------- | --------- |
| Demo allow   | `ruby main.rb --mode demo`                        | Mock client (`withinLimits: true`) | fixtures  |
| Demo paywall | `ruby main.rb --mode demo --gate`                 | Mock paywall                       | fixtures  |
| Demo live    | `--mode demo --source live`                       | Mock                               | real HTTP |
| HTTP         | `scripts/http.sh` or `pnpm mcp:bitcoin-analytics` | Real `SolvaPay.create`             | live      |
| HTTP + ngrok | `pnpm mcp:bitcoin-analytics:tunnel`               | Real `SolvaPay.create`             | live      |

```bash
# monorepo load path (do not Bundler-path the Ruby gem — that compiles Magnus)
export RUBYLIB="$(pwd)/../../../sdks/ruby/lib:$(pwd)/../../../sdks/ruby-mcp/lib${RUBYLIB:+:$RUBYLIB}"

ruby main.rb --mode demo
ruby main.rb --mode demo --gate
```

HTTP serve binds `127.0.0.1:3030` by default — the same reserved
`mcpapp` origin as stock-research and weather-mcp
(`https://appmcp.jack-local.ngrok.app` → `localhost:3030`). Only one of
those examples can own the origin at a time. Requires Puma
(`gem install puma`).

```bash
# from repo root — copies the same .env keys as weather-mcp / stock-research
pnpm mcp:bitcoin-analytics          # local http://127.0.0.1:3030/mcp
pnpm mcp:bitcoin-analytics:tunnel   # https://appmcp.jack-local.ngrok.app/mcp
```

In MCPJam, connect to **`https://appmcp.jack-local.ngrok.app/mcp`** (tunnel)
or `http://127.0.0.1:3030/mcp` (local-only).

| Variable                      | Required     | Notes                                                   |
| ----------------------------- | ------------ | ------------------------------------------------------- |
| `SOLVAPAY_SECRET_KEY`         | yes          | Copied from the other MCP examples' `.env`              |
| `SOLVAPAY_PRODUCT`            | yes          | Same `prd_*` as weather / stock-research                |
| `MCP_PUBLIC_BASE_URL`         | yes for HTTP | Defaults to `https://appmcp.jack-local.ngrok.app`       |
| `BITCOIN_ANALYTICS_NGROK_URL` | no           | Same reserved origin; do not use the mcp-proxy wildcard |
| `SOLVAPAY_API_BASE_URL`       | no           | Local stack: `http://localhost:3010`                    |
| `MCP_HOST` / `MCP_PORT`       | no           | Default `127.0.0.1` / `3030`                            |
| `MCP_SOURCE`                  | no           | `live` for real upstreams                               |

## Tests

```bash
cd examples/ruby/bitcoin_analytics_mcp
ruby -I../../../sdks/ruby/lib -I../../../sdks/ruby-mcp/lib test/run.rb
```

From `sdks/ruby-mcp` after `bundle install`:

```bash
bundle exec ruby -Ilib ../../examples/ruby/bitcoin_analytics_mcp/test/run.rb
```

CI never calls the public Bitcoin APIs. Fixtures are recorded and trimmed
(`fee_histogram` dropped, 3 mempool-blocks, 10 recent txs, 2-hop trace).
`fixtures/btcnode_addr_error.json` documents the `success: false` raise path;
`fixtures/btcnode_addr_success.json` is a regression-shaped payload the live
endpoint does not currently return.
