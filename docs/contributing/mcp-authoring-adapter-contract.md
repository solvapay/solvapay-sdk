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
   `tools/call` framing, input-schema validation, result serialization. Never
   reimplemented in the SolvaPay core. TypeScript uses
   `@modelcontextprotocol/server`.
2. **Layer 2 — shared Rust decision core.** Classify → build gate → decide,
   `paywallToolResult` envelope, `buildPayableToolResult` allow-path unwrap,
   `checkLimits` / `trackUsage`. Gate `message` and `structuredContent` are
   byte-identical across languages because they come from this one core.
3. **Layer 3 — hand-written adapter (this contract).** Registers a merchant
   handler as a paywalled tool, resolves the customer, runs the layer-2
   decision, unwraps `ctx.respond` into an MCP `CallToolResult`, and records
   usage. TypeScript: `registerPayableTool` + `buildPayableHandler`.

Layer 3 owns: customer-ref resolution _hooks_, compiling a merchant `handler`
into `ctx.respond` / `ctx.gate` / `ctx.emit`, registering the tool on the
host SDK, unwrapping the response envelope, and projecting usage. Layer 3
must **delegate** paywall classification, gate assembly, gate narration, and
`paywallToolResult` shaping to layer 2. It must not rewrite gate copy.

## Required public surface

Each language exposes a `registerPayable` equivalent that takes:

- the host MCP server object
- a tool `name`
- `product` (product ref)
- optional `title`, `description`, input schema
- `handler: (args, ctx) => ctx.respond(...)`
- optional `getCustomerRef(args) => string` (the `"hook"` customer-ref source)

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

1. **Resolve customer ref.** `"hook"` → `getCustomerRef`. `"toolArgs"` →
   `args.customer_ref` (the tool `inputSchema` must declare `customer_ref` so
   the host MCP SDK forwards it). HTTP `authInfo` plumbing is
   TypeScript-transport-specific and out of this corpus.
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
   `input.args`, `expect.result`). `input.fn` is always `registerPayable`.
3. Validate `input.args` as the scenario documented next to the corpus
   (`contract/mcp-fixtures/README.md`) — no silent defaults.
4. Register the tool on a real host MCP server, drive `initialize` →
   `notifications/initialized` → `tools/call`, and assert `toolResult` plus
   the usage projection.
5. Install the language's native layer-2 dispatch so gate copy comes from
   Rust (`paywallToolResult`), not a hand-written fallback.
6. Mirror `pnpm test:mcp-contract` as the focused command.

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
