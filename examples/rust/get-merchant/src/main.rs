//! Async `get_merchant` using `examples/rust/get-merchant/.env`.
//!
//! ```bash
//! cp .env.example .env
//! cargo run --manifest-path examples/rust/get-merchant/Cargo.toml
//! ```

use solvapay::{Client, Config};
use solvapay_example_get_merchant::run;
use solvapay_rust_examples_env::load_get_merchant_dotenv;

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    load_get_merchant_dotenv()?;
    let config = Config::default();
    if config.api_key.is_empty() {
        return Err("SOLVAPAY_SECRET_KEY is missing — copy .env.example to .env".into());
    }
    let client = Client::new(config).map_err(|err| format!("Client::new: {err:?}"))?;
    let merchant = run(&client)
        .await
        .map_err(|err| format!("get_merchant: {err:?}"))?;
    println!(
        "merchant displayName={:?} defaultCurrency={:?}",
        merchant.display_name, merchant.default_currency
    );
    Ok(())
}
