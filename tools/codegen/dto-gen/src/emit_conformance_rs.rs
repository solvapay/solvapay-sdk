//! Rust fixture-conformance host-fn table (parity with Python/Ruby/Go chrome).

use crate::emit_conformance_chrome::HOST_FNS;
use crate::error::GenResult;
use crate::header::{generated_header, CommentStyle};
use crate::ir::Ir;

/// `sdks/rust/tests/common/host_fns.generated.rs`
pub fn emit_conformance_rs(_ir: &Ir) -> GenResult<String> {
    let mut out = generated_header(CommentStyle::LineSlash, "rs-conformance-out");
    out.push_str("\n#![allow(dead_code)]\n\n/// Host-adapter fn names shared with other language harnesses.\npub const HOST_FNS: &[&str] = &[\n");
    for id in HOST_FNS {
        out.push_str("    \"");
        out.push_str(id);
        out.push_str("\",\n");
    }
    out.push_str("];\n");
    Ok(out)
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
mod tests {
    use super::*;

    #[test]
    fn emits_every_host_fn() {
        let src = emit_conformance_rs(&Ir::default()).unwrap();
        for id in HOST_FNS {
            assert!(src.contains(&format!("\"{id}\"")), "{src}");
        }
    }
}
