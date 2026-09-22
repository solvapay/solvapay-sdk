#![no_main]

use libfuzzer_sys::fuzz_target;
use solvapay_c::fuzz_oracle::check_c_dispatch_envelope;
use solvapay_core::fuzz_oracle::EnvelopeFuzzInput;

fuzz_target!(|data: &[u8]| {
    let Some(input) = EnvelopeFuzzInput::decode(data) else {
        return;
    };
    if check_c_dispatch_envelope(&input.op, &input.args_json).is_err() {
        std::process::abort();
    }
});
