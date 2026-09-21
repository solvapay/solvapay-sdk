# MCP fixtures

Language-neutral conformance corpus for MCP protocol handling and payable
authoring. This tree is **not** part of `contract/fixtures/`. Layer-2 runners
hard-fail on an unknown `input.fn` from that other tree.

Normative payable-adapter behavior:
[`docs/contributing/mcp-authoring-adapter-contract.md`](../../docs/contributing/mcp-authoring-adapter-contract.md).

## Corpus

22 suites, 140 JSON files. Counts below are the files on disk.

The frozen replay lists are the authority for which of those files each
language runner must include. They live in the sources named by
`MCP_REPLAY_LIST_FILES` in
[`tools/conformance/lib/mcp-fixture-coverage.ts`](../../tools/conformance/lib/mcp-fixture-coverage.ts):

- `tools/conformance/mcp-authoring/mcp-authoring-fixtures.test.ts`
- `sdks/python-mcp/tests/mcp_authoring/test_mcp_authoring_fixtures.py`
- `sdks/go/mcp/fixtures_test.go`
- `sdks/ruby-mcp/test/mcp_authoring_fixtures_test.rb`
- `sdks/rust-mcp/tests/mcp_authoring_fixtures.rs`

`replayListDrift` fails when a list and the on-disk corpus disagree.
HTTP engine runners (`HTTP_ENGINE_FILES` in the same module) skip
`engine/invoke-handler.json`.

| Suite | Files | `input.fn` |
| --- | ---: | --- |
| `allow` | 8 | `registerPayable` |
| `auth-gate` | 4 | `mcpAuthGate` |
| `bearer-verify` | 6 | `mcpVerifyBearer` |
| `bootstrap` | 2 | `mcpBootstrap` |
| `builtin-tools` | 25 | `mcpCallBuiltinTool` |
| `config-log` | 1 | `mcpConfigLog` |
| `csp` | 2 | `mcpMergeCsp` |
| `customer-ref` | 2 | `registerPayable` |
| `dcr` | 2 | `mcpDcrDiagnostics` |
| `default-gate` | 2 | `mcpDefaultGate` |
| `descriptors` | 2 | `mcpDescriptors` |
| `dispatch` | 3 | `mcpDispatch` |
| `engine` | 18 | `mcpHandleRequest`, `mcpResume`, `mcpWidgetResource` |
| `error` | 1 | `registerPayable` |
| `gate` | 3 | `registerPayable` |
| `hide-tools` | 6 | `mcpHandleRequest`, `mcpHideToolsByAudience` |
| `narrate` | 19 | `mcpNarrate` |
| `native-cors` | 5 | `mcpNativeCors` |
| `oauth` | 14 | `mcpNormalizeOauthError`, `mcpOauthDiscovery`, `mcpOauthErrorInspect`, `mcpOauthPath`, `mcpOauthRequest` |
| `oauth-proxy` | 8 | `mcpOauthRequest` |
| `overview` | 1 | `mcpOverviewResource` |
| `resolve-auth` | 6 | `mcpResolveAuth` |

`registerPayable` cases (`allow`, `customer-ref`, `error`, `gate`) are the
layer-3 authoring scenarios: `input.args` describes the tool, product,
customer ref, limits, and handler, and `expect.result` is
`{ toolResult, usage }`. Every other suite is an op-specific JSON case for
the `input.fn` in the table. Do not treat the payable scenario fields as the
shape of the whole corpus.

Gate `content[0].text` and `structuredContent` on payable cases are layer-2
output (`paywallToolResult`), not adapter-authored copy. Narration markdown
comes from the Rust `mcpNarrate` op.

## Run

```bash
pnpm test:mcp-contract
cd sdks/python-mcp && uv sync --extra dev && uv run --extra dev pytest -q
cd sdks/ruby-mcp && RUBYLIB=$(pwd)/../ruby/lib bundle exec rake test
cd sdks/go && go test ./mcp/...
cargo test -p solvapay-mcp
```

`pnpm test:mcp-contract` is included in `pnpm test:contract`.

## How to add a case

1. Add `suite/case.json` under this directory. `suite` matches the directory.
   Reject unknown fields. Do not default missing scenario keys.
2. Add the same relative path to every frozen replay list above. A list that
   drifts from the directory fails `replayListDrift`.
3. For a new `input.fn`, register it in the language runners. Payable cases
   compile `handler` into `ctx.respond` / `ctx.gate` / `ctx.emit` and drive a
   real host MCP server. Engine and sync-op cases call the named Rust op.
