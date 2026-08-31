# Rust SDK — paid MCP

Runnable paywalled MCP tool against a mock backend.

```bash
cargo run --manifest-path examples/rust/paid-mcp/Cargo.toml
cargo run --manifest-path examples/rust/paid-mcp/Cargo.toml -- --gate
```

This is an offline single-tool round-trip demo: a bare MCP server with
no SolvaPay intent tools. Do not copy it as a production server shape;
use `guerrillamail-mcp` or a TypeScript checkout example for the full
catalog.

## Offline test

```bash
cargo test --manifest-path examples/rust/paid-mcp/Cargo.toml
```
