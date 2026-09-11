#![no_main]

use libfuzzer_sys::fuzz_target;
use solvapay_c::fuzz_oracle::{check_handle_sequence, HandleSequence};

fuzz_target!(|data: &[u8]| {
    let Some(seq) = HandleSequence::decode(data) else {
        return;
    };
    if check_handle_sequence(&seq).is_err() {
        std::process::abort();
    }
});
