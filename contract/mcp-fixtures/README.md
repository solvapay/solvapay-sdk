# MCP-authoring fixtures

Language-neutral conformance corpus for layer-3 payable-MCP adapters
(`registerPayable` / `ctx.respond`). Replayed by the TypeScript reference
harness in `tools/conformance/mcp-authoring/` against `@solvapay/mcp` on a
real `McpServer`. MA-Py / MA-Rb / MA-Go / MA-Rs write a dispatcher only.

Normative behavior: [`docs/contributing/mcp-authoring-adapter-contract.md`](../../docs/contributing/mcp-authoring-adapter-contract.md).

This tree is **not** part of `contract/fixtures/`. Layer-2 runners hard-fail
on unknown `input.fn`.

## Format (§5.3)

Same envelope as `contract/fixtures/` (`parseFixture`). `input.fn` is always
`registerPayable`. `input.args` is a declarative scenario; `expect.result` is
a composite observation.

| Field            | Role                                                    |
| ---------------- | ------------------------------------------------------- |
| `suite` / `case` | Identity; directory layout mirrors suite names          |
| `input.fn`       | Always `registerPayable`                                |
| `input.args`     | Scenario (tool, product, customer ref, limits, handler) |
| `expect.result`  | `{ toolResult, usage }`                                 |

## Scenario spec (`input.args`)

| Field               | Shape                                                                                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tool`              | `{ name, title?, description?, inputSchema?, args }` — MCP `tools/call` name, optional JSON Schema-ish field map (`{ "customer_ref": { "type": "string" } }`), and arguments |
| `product`           | Product ref passed to the adapter                                                                                                                                            |
| `usageType`         | Optional meter name forwarded to `trackUsage.metadata.action` (omit to default `requests`)                                                                                   |
| `customerRef`       | Identity string                                                                                                                                                              |
| `customerRefSource` | `"hook"` (`getCustomerRef`) or `"toolArgs"` (`args.customer_ref`)                                                                                                            |
| `limits`            | Exact `checkLimits` payload the mock backend returns (no defaults)                                                                                                           |
| `handler`           | `{ kind: "respond", data, options?, emit? }`, `{ kind: "gate", reason? }`, or `{ kind: "throw", message }`                                                                   |

## Observation (`expect.result`)

```json
{
  "toolResult": {
    "content": [{ "type": "text", "text": "..." }],
    "structuredContent": {}
  },
  "usage": [
    {
      "outcome": "success",
      "actionType": "api_call",
      "units": 1,
      "productRef": "prd_demo",
      "customerRef": "cus_from_args",
      "metadata": { "action": "requests" }
    }
  ]
}
```

`usage` is the ordered projection of `trackUsage`. Harnesses must assert that
raw calls also carry `duration`, `timestamp`, and `metadata.requestId`
without pinning their values.

Gate `content[0].text` and `structuredContent` are layer-2 output
(`buildPaywallGate` / `paywallToolResult`), not adapter-authored copy.

## Corpus

| Path                                | Axis                                    |
| ----------------------------------- | --------------------------------------- |
| `allow/custom-usage-type.json`      | custom `usageType` reaches `metadata.action` |
| `allow/respond-minimal.json`        | `ctx.respond(data)`                     |
| `allow/respond-text-option.json`    | `options.text`                          |
| `allow/respond-nudge.json`          | nudge suffix; structured data unchanged |
| `allow/respond-emitted-blocks.json` | `ctx.emit` blocks precede text          |
| `allow/respond-key-order.json`      | compact JSON text preserves key order   |
| `gate/payment-required.json`        | pre-check `payment_required`            |
| `gate/activation-required.json`     | pre-check `activation_required`         |
| `gate/handler-invoked.json`         | allow then `ctx.gate`; no `fail` usage  |
| `error/handler-throws.json`         | `isError: true`; usage `fail`           |
| `customer-ref/from-tool-args.json`  | `args.customer_ref`                     |
| `customer-ref/from-hook.json`       | `getCustomerRef` hook                   |

## Run

```bash
pnpm build:packages
pnpm test:mcp-contract
cd sdks/python-mcp && uv sync --extra dev && uv run --extra dev pytest -q
cd sdks/ruby-mcp && RUBYLIB=$(pwd)/../ruby/lib bundle exec rake test
cd sdks/go && go test ./mcp/...
cargo test -p solvapay-mcp
```

The suite is included in `pnpm test:contract`.

## How to add a language runner

1. Discover `*.json` recursively under this directory (via `lookups.mcpFixtures`).
2. Parse with the §5.3 schema. Reject unknown fields and missing required
   scenario keys — do not default them.
3. Compile `handler` into the language's `ctx.respond` / `ctx.gate` / `ctx.emit`.
4. Register on a **real** host MCP server; drive `initialize` →
   `notifications/initialized` → `tools/call`.
5. Install native layer-2 `paywallToolResult` so gate copy is Rust-sourced.
6. Assert `toolResult` byte-for-byte and the usage projection.
