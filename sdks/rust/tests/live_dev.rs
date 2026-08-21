//! Live dev API smoke (opt-in). Uses `examples/rust/get-merchant/.env` via `solvapay-rust-examples-env`.
//!
//! ```bash
//! cp examples/rust/get-merchant/.env.example examples/rust/get-merchant/.env
//! cd rust && cargo test -p solvapay live_dev_get_merchant_from_env -- --ignored --nocapture
//! ```

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use solvapay::{Client, Config};
use solvapay_rust_examples_env::load_get_merchant_dotenv;

#[tokio::test]
#[ignore = "live dev API; requires examples/rust/get-merchant/.env"]
async fn live_dev_get_merchant_from_env() {
    load_get_merchant_dotenv().expect("load examples/rust/get-merchant/.env");
    let config = Config::default();
    assert!(
        !config.api_key.is_empty(),
        "SOLVAPAY_SECRET_KEY missing in examples/rust/get-merchant/.env"
    );
    let client = Client::new(config).expect("Client::new");
    let merchant = client.get_merchant().await.expect("get_merchant");
    eprintln!(
        "live get_merchant ok: displayName={:?}",
        merchant.display_name
    );
}
