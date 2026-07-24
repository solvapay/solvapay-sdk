# Rust facade — get merchant

Minimal async example for the `solvapay` crate (Steps 46/48). Offline mock-transport test covers `run(...)`; live `.env` is optional.

Credentials live in **this directory’s** `.env` (not committed). Path resolution is centralized in `examples/rust/env`.

## Offline test (CI-safe)

```bash
cargo test --manifest-path examples/rust/get-merchant/Cargo.toml
```

## Setup (live run)

```bash
cp .env.example .env
# Edit .env with your sandbox secret and optional API base URL.
```

## Run

From the repo root:

```bash
cargo run --manifest-path examples/rust/get-merchant/Cargo.toml
```

Or from `rust/`:

```bash
cargo run --manifest-path ../examples/rust/get-merchant/Cargo.toml
```

## Live integration test (facade crate)

```bash
cd rust
cargo test -p solvapay live_dev_get_merchant_from_env -- --ignored --nocapture
```

Requires `examples/rust/get-merchant/.env`.
