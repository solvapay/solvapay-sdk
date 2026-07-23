# Rust SDK examples

| Example | Description |
| --- | --- |
| [`get-merchant`](./get-merchant/) | Async `Client::get_merchant` with local `.env` (offline mock-transport test covered) |

Shared dotenv paths live in [`env/`](./env/) (`solvapay-rust-examples-env`).

## Test (CI-safe, offline)

```bash
cargo test --manifest-path examples/rust/get-merchant/Cargo.toml
```

## Live run (optional credentials)

```bash
cp examples/rust/get-merchant/.env.example examples/rust/get-merchant/.env
# Edit .env with your sandbox secret.
cargo run --manifest-path examples/rust/get-merchant/Cargo.toml
```
