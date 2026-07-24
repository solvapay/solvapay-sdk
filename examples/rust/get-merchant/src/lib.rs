//! Testable `get_merchant` example logic (Step 48).

use solvapay::{Client, SdkError, SdkMerchantResponseDto};

/// Fetches the merchant profile via the public async client.
///
/// # Errors
///
/// Returns [`SdkError`] from the underlying `get_merchant` call.
pub async fn run(client: &Client) -> Result<SdkMerchantResponseDto, SdkError> {
    client.get_merchant().await
}
