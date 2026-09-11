# solvapay-mcp (Rust)

Payable MCP adapter over [`rmcp`](https://crates.io/crates/rmcp) 3.x.
Layer 3 is hand-written Rust. Paywall copy and compact `respond` text come from
`solvapay-core` (layer 2) — never from adapter-authored strings.

This crate is unpublished (`publish = false`).

## Tests

```bash
cargo test -p solvapay-mcp
cargo test -p solvapay-mcp --features test-seams
cargo clippy -p solvapay-mcp --all-targets -- -D warnings
```

Normative contract: [`mcp-authoring-adapter-contract.md`](../../docs/contributing/mcp-authoring-adapter-contract.md).
