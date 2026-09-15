#![no_main]

use libfuzzer_sys::fuzz_target;
use solvapay_core::fuzz_oracle::{check_webhook_invariants, WebhookFuzzInput};

fuzz_target!(|data: &[u8]| {
    let Some(input) = WebhookFuzzInput::decode(data) else {
        return;
    };
    if check_webhook_invariants(&input).is_err() {
        std::process::abort();
    }
});
