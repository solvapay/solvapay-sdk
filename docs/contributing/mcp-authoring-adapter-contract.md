# MCP-authoring adapter contract

Normative spec for a language's layer-3 payable-MCP adapter (`registerPayable` /
`ctx.respond`). MA-0's TypeScript `@solvapay/mcp` adapter is the reference
implementation. MA-Py / MA-Rb / MA-Go / MA-Rs implement this contract against
the shared corpus at `contract/mcp-fixtures/` (resolved via
`lookups.mcpFixtures` in `contract/manifest/repo-paths.yaml`).

This document is the source of fixture expectations. Gate copy is never
authored here or in an adapter — it is produced by the layer-2 Rust decision
core (`buildPaywallGate` / `buildGateMessage` / `paywallToolResult`).

## Three layers

1. **Layer 1 — MCP protocol (per-ecosystem SDK).** `McpServer`, transports,
   SSE / streamable HTTP, `tools/call` framing. Never reimplemented in the
   SolvaPay core. C has no host MCP SDK: the reference adapter is
   [`sdks/capi/ctest/mcp_engine.c`](../../sdks/capi/ctest/mcp_engine.c), which
   routes HTTP through `solvapay_client_call("mcpDispatch" | "mcpOauthRequest")`
   and resumes payable tools with `solvapay_call("mcpResume", …)`.
2. **Layer 2 — shared Rust MCP core** (`core/solvapay-mcp`, plus payable
   decisions in `solvapay-core`). Sync ops (`mcpDescriptors`, `mcpAuthGate`,
   `mcpOauthDiscovery`, `mcpMergeCsp`, …) are `(args_json) -> envelope` via
   `solvapay_call`. Async fan-out (`mcpBootstrap`, `mcpCallBuiltinTool`,
   `mcpReadResource`, `mcpOauthRequest`, `mcpDispatch`) lives on
   `SolvaPayClient`. `mcpDispatch` services builtin tools and resources
   internally and, for a merchant payable tool, returns
   `{kind:"invokeHandler", token, …}` so the host runs the handler and
   resumes with `mcpResume`. Gate `message` / `structuredContent` still
   come from `paywallToolResult` — the engine does not author gate copy.
3. **Layer 3 — thin host glue (~150–280 code lines).** Descriptor → host-SDK
   registration, converting the web framework request into
   `mcpOauthRequest` / `mcpDispatch` JSON, invoking the merchant
   handler on `invokeHandler`, and passing the bearer header or resolved
   `customerRef` **in** as JSON. There is no `getCustomerRef` callback into
   Rust. HTTP `authInfo` plumbing is no longer TypeScript-specific; every
   language feeds `authHeader` on the engine op. The C file above is the
   smallest expression of that loop (OAuth + three-way dispatch branch +
   demo `mcpResume`); stringly-typed ABI JSON lives in `mcp_json.c` beside
   it. Languages with a payable host SDK reuse their existing gate instead
   of the echo handler.

Layer 3 must **delegate** paywall classification, gate assembly, gate
narration, and `paywallToolResult` shaping to layer 2. It must not rewrite
gate copy.

## Required public surface

Each language exposes a `registerPayable` equivalent that takes:

- the host MCP server object
- a tool `name`
- `product` (product ref)
- optional `title`, `description`, input schema
- `handler: (args, ctx) => ctx.respond(...)`
- optional `getCustomerRef(args) => string` (layer-3 `"hook"` source; resolved
  in the host and passed into layer 2 as JSON — Rust never calls back out)

`ctx` members (sourced from TypeScript `PayableHandler` / `ResponseContext`):

| Member                    | Role                                                                                                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `respond(data, options?)` | Terminal allow result. `options.text` replaces the JSON text block. `options.nudge.message` is appended after a `\n\n` separator. `options.units` is accepted and ignored in V1 (billing stays 1 unit). |
| `gate(reason?)`           | Stops the handler and formats a paywall result. Default reason is `Payment required`.                                                                                                                   |
| `emit(block)`             | Queues a content block flushed _before_ the text block at `respond` time.                                                                                                                               |
| `customer`                | Snapshot from the pre-check limits (`ref`, `balance`, `remaining`, `withinLimits`, `plan`).                                                                                                             |
| `product`                 | Read-only product projection.                                                                                                                                                                           |

The handler **must** return the branded envelope from `ctx.respond`. Returning
a raw value is a loud error, not a silent wrap.

## Mandatory decision sequence

1. **Resolve customer ref.** `"hook"` → host `getCustomerRef` (layer 3). `"toolArgs"` →
   `args.customer_ref` (the tool `inputSchema` must declare `customer_ref` so
   the host MCP SDK forwards it). Pass the resolved ref or the raw `Authorization`
   header into `mcpAuthGate` / `mcpDispatch` as JSON. This is not
   TypeScript-specific.
2. **Ensure customer.** Map the resolved identity to a backend customer ref
   (`createCustomer` / `getCustomer` as the language client already does).
3. **Decide** via layer 2 (`paywall.decide` / `decidePaywallOutcome`):
   - **gate:** format the layer-2 gate (`formatGate` / `paywallToolResult`) and
     track usage with outcome `paywall`. Do not invoke the merchant handler.
   - **allow:** invoke the merchant handler (`runAllow`).
4. **On allow:** unwrap the `respond` envelope into `CallToolResult` and track
   usage with outcome `success`.
5. **On `ctx.gate()`:** format the layer-2-compatible paywall result (`isError:
false`). Do **not** emit `fail` usage. Do **not** emit `success`.
6. **On thrown non-paywall errors:** `isError: true` and usage outcome `fail`.

## Result-shape contract

### Allow (`ctx.respond`)

- `content`: queued `emit` blocks, then one `{ type: "text", text }` block.
- Default text is `JSON.stringify(data)` (no pretty-print).
- `options.text` replaces that text (emitted blocks still precede it).
- Nudge: `${baseText}\n\n${nudge.message}` when `nudge.message` is non-empty.
- `structuredContent` is the **raw merchant `data`**, not the envelope.
- `isError` is unset / omitted. Host result models that force a boolean may
  emit `false` instead; treat absent-or-`false` as the allow path. Do not
  strip the field in a runner. The Go MCP SDK's `CallToolResult.IsError` uses
  `json:"isError,omitempty"`, so `false` never reaches the wire — runners must
  treat absent-or-false as equivalent on both sides, while still requiring
  `isError: true` on the error fixture.
- `_meta` is unset on the payable-tool path (no UI resource stamping).

### Gate (pre-check or `ctx.gate`)

- `isError` is `false` (a gate is not a tool failure).
- `content[0].text` is the gate `message` from layer 2 (or the merchant
  `reason` for `ctx.gate`).
- `structuredContent` is the gate object from layer 2, passed through
  **untouched**. Pre-check gates use `buildPaywallGate` kinds
  `payment_required` or `activation_required`. `ctx.gate(reason)` uses
  `kind: "payment_required"`, `message: reason`, `checkoutUrl: ""`,
  `product` = the registered product ref.
- `_meta` is unset on the payable-tool path.

Layer-2 copy for the corpus's pre-check gates (must match
`contract/fixtures/paywall/` for the same limits):

- `withinLimits: false` + `checkoutUrl` and no activation / balance-product
  extras → `kind: payment_required`, message
  `You don't have an active plan for this tool. Call the \`upgrade\` tool to pick a plan, or open <checkoutUrl> in a browser.`
- `activationRequired: true` + `plans` + `confirmationUrl` →
  `kind: activation_required`, message
  `Your plan needs activation before you can use this tool. Call the \`activate_plan\` tool to activate it, or open <confirmationUrl> in a browser.`
(`checkoutUrl` on the gate is the confirmation URL.)

### Error (handler throws)

- `isError: true`.
- `content[0].text` is pretty-printed JSON (2-space indent):

  ```json
  {
    "success": false,
    "error": "<throw message>"
  }
  ```

- `structuredContent` is unset.

## Usage-outcome contract

Project `trackUsage` calls as an ordered list of:

`{ outcome, actionType, units, productRef, customerRef, metadata.action }`

Volatile fields `duration`, `timestamp`, and `metadata.requestId` must be
**present** on the raw call but are not pinned.

| Path           | Outcomes                                                             |
| -------------- | -------------------------------------------------------------------- |
| Allow          | one call, `outcome: "success"`, `actionType: "api_call"`, `units: 1` |
| Pre-check gate | one call, `outcome: "paywall"`                                       |
| `ctx.gate()`   | **no** `fail` entry (and no `success`)                               |
| Handler throw  | one call, `outcome: "fail"`                                          |

`metadata.action` is the resolved meter name, defaulting to `requests`.
`customerRef` is the **backend** ref after ensure-customer.

## Explicit non-requirements

These stay per-ecosystem host concerns and are **not** asserted by
`contract/mcp-fixtures/`:

- Transport (HTTP / SSE / stdio / in-memory)
- OAuth / DCR
- CORS / CSP
- Narration beyond the layer-2 gate message and `respond` text rules
- UI resource stamping (`_meta.ui`)

They match the never-moves list in [`architecture.md`](./architecture.md).

## How to add a language runner

1. Load `*.json` recursively from the `mcpFixtures` lookup path.
2. Parse each file with the §5.3 envelope (`suite`, `case`, `input.fn`,
   `input.args`, `expect.result`). `input.fn` is `registerPayable` for
   payable scenarios and a Rust op name (`mcpDispatch`, `mcpNarrate`, …)
   for core characterization fixtures.
3. **Characterization fixtures are immutable.** Once committed under
   `contract/mcp-fixtures/`, do not edit a fixture to make an
   implementation pass. A mismatch is a regression in the runner or the
   Rust core.
4. Replay **every** corpus file. Payable suites go through
   `registerPayable`. Sync ops go through `solvapay_call` /
   `callMcpSyncOp`. Async ops (`mcpDispatch`, `mcpOauthRequest`,
   `mcpBootstrap`, `mcpCallBuiltinTool`) go through the language client.
   Do not list a suite and early-return without asserting.
5. Validate `registerPayable` `input.args` as the scenario documented next
   to the corpus (`contract/mcp-fixtures/README.md`) — no silent defaults.
6. Register the tool on a real host MCP server, drive `initialize` →
   `notifications/initialized` → `tools/call`, and assert `toolResult` plus
   the usage projection.
7. Install the language's native layer-2 dispatch so gate copy comes from
   Rust (`paywallToolResult`), not a hand-written fallback.
8. Mirror `pnpm test:mcp-contract` as the focused command. C skips only
   `registerPayable` (no payable host SDK); every other `input.fn` must
   assert.

## Host / core boundary

`mcpDispatch` is the single JSON-RPC entry point. Hosts convert the HTTP
request into `{ rpc, config, authHeader }`, call `mcpDispatch`, and
branch three ways:

| `kind`           | Host work                                              |
| ---------------- | ------------------------------------------------------ |
| `rpc`            | Write the JSON-RPC body (usually HTTP 200)             |
| `challenge`      | Write `status` + `WWW-Authenticate` + body             |
| `invokeHandler`  | Run the merchant handler, then `mcpResume` with the token |

OAuth and discovery HTTP go through `mcpOauthRequest`. Builtin tools and
resources are serviced **inside** `mcpDispatch`; hosts never handle
`callBuiltin` / `readResource` envelopes.

What stays per language: MCP protocol transport, request/response body
conversion, framework routing, host-SDK tool registration, bearer parse
to `authHeader` / `customerRef`, and invoking the merchant handler.

Production layer-3 HTTP engines:

| Language   | Adapter | Payables |
| ---------- | ------- | -------- |
| Rust       | `sdks/rust-mcp/src/server.rs` | `mcpDispatch` → `invokeHandler` → `mcpResume` |
| Go         | `sdks/go/mcp/handler.go` + `server.go` | `mcpDispatch` → `invokeHandler` → `mcpResume` (same as Rust/Ruby) |
| Ruby       | `sdks/ruby-mcp/lib/solvapay/mcp/engine.rb` | `mcpDispatch` → `invokeHandler` → `mcpResume` |
| C          | `sdks/capi/ctest/mcp_engine.c` | `mcpDispatch` → `invokeHandler` → `mcpResume` |
| TypeScript | `sdks/typescript/mcp-core/src/engine-dispatch.ts` + fetch JSON `POST /mcp` | `mcpDispatch` |
| Python     | `sdks/python-mcp/python/solvapay_mcp/server/engine.py` + Starlette `create_mcp_engine_starlette` | `mcpDispatch` |

Characterization fixtures under `contract/mcp-fixtures/` are immutable
expectations. Replay must assert equality (or the documented
`invoke-handler.json` / `tools-list.json` partials); do not early-return a
suite without asserting.

Layer-3 non-transport glue (the dispatch loop + OAuth router) is gated
to **≤ 280 code lines** per reference adapter (`pnpm mcp-layer3-budget:check`).
The C file above is the smallest expression of that loop.

## Go host-model notes (MA-Go)

- Register with the low-level `Server.AddTool(tool, ToolHandler)`, not generic
  `mcp.AddTool`. The generic form auto-populates `IsError`/`Content` and
  validates schemas, which would destroy byte-exact result control. Tool-level
  failures must be returned as a `*CallToolResult`, never as a Go `error`.
- `ctx.gate()` cannot throw. `ResponseContext.Gate` returns a `*GateSignal`
  error; the adapter detects it with `errors.As`.
- Go maps marshal with sorted keys. `Respond` accepts `json.RawMessage` so the
  fixture's `data` (and Rust compact JSON) keep insertion order. Struct-field
  order is correct; `map[string]any` is a documented Go limitation.
- `structuredContent` must be assigned as `json.RawMessage` so the Rust payload
  is emitted byte-verbatim rather than re-sorted.

## Rust host-model notes (MA-Rs)

- Register with `ToolRouter::add_route` + `ToolRoute::new_dyn`. Return
  `CallToolResult` (converted to `CallToolResponse`) for tool-level allow, gate,
  and handler failures. Only transport/SDK failures become `ErrorData`.
- `ctx.gate()` cannot throw. `ResponseContext::gate` returns `PayableError::Gate`;
  `invoke_payable` formats it through layer-2 `paywall_tool_result`.
- `CallToolResult::success` sets `isError: Some(false)`. The allow path overwrites
  `is_error` from layer 2 (`None`). Fixture drivers project `isError` away except
  when it is `true` or the gate `kind` is `payment_required` / `activation_required`.
- Host SDK is `rmcp` 3.x (workspace pin 3.1.4). Replay uses an in-process
  `tokio::io::duplex` pair, not a TCP listener.

Do **not** drop these files into `contract/fixtures/`. Layer-2 harnesses
(Python/Go/C/Rust) hard-fail on unknown `input.fn`.
