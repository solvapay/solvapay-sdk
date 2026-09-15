//! TypeScript fixture-harness host-fn table (parity with Python/Ruby/Go chrome).

use crate::emit_conformance_chrome::HOST_FNS;
use crate::error::GenResult;
use crate::header::{generated_header, CommentStyle};
use crate::ir::Ir;

/// `tools/conformance/lib/host-fns.generated.ts`
pub fn emit_conformance_ts(_ir: &Ir) -> GenResult<String> {
    let mut out = generated_header(CommentStyle::Block, "ts-conformance-out");
    out.push_str("\nexport const HOST_FNS = [\n");
    for id in HOST_FNS {
        out.push_str("  '");
        out.push_str(id);
        out.push_str("',\n");
    }
    out.push_str("] as const\n\nexport type HostFn = (typeof HOST_FNS)[number]\n");
    Ok(out)
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
mod tests {
    use super::*;

    #[test]
    fn emits_every_host_fn() {
        let src = emit_conformance_ts(&Ir::default()).unwrap();
        for id in HOST_FNS {
            assert!(src.contains(&format!("'{id}'")), "{src}");
        }
    }
}
