# solvapay

Official SolvaPay Rust SDK — async-first facade over `solvapay-transport` and `solvapay-core`.

```toml
[dependencies]
solvapay = "0.1"
```

```rust
use solvapay::{Client, Config};

#[tokio::main]
async fn main() -> Result<(), solvapay::SdkError> {
    let client = Client::new(Config::default())?;
    let merchant = client.get_merchant().await?;
    println!("{:?}", merchant.display_name);
    Ok(())
}
```

Enable the optional `blocking` feature for a synchronous `solvapay::blocking::BlockingClient`.

Docs: [docs.rs/solvapay](https://docs.rs/solvapay) · Examples: `examples/rust/` in the [solvapay-sdk](https://github.com/solvapay/solvapay-sdk) repository.
