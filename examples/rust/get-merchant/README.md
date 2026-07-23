# Rust facade — get merchant

Minimal async example for the Step 46 `solvapay` crate.

Credentials live in **this directory’s** `.env` (not committed). Path resolution is centralized in `examples/rust/env`.

## Setup

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

## Live integration test

```bash
cd rust
cargo test -p solvapay live_dev_get_merchant_from_env -- --ignored --nocapture
```

Requires `examples/rust/get-merchant/.env`.
