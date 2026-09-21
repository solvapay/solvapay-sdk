//! TypeScript fixture-harness host-fn table (parity with Python/Ruby/Go chrome).

use crate::emit_conformance_chrome::HOST_FNS;
use crate::error::GenResult;
use crate::header::{generated_header, CommentStyle};
use crate::ir::{Ir, IrBindingArtifact};

/// `tools/conformance/lib/host-fns.generated.ts`
pub fn emit_conformance_ts(ir: &Ir) -> GenResult<String> {
    let mut out = generated_header(CommentStyle::Block, "ts-conformance-out");
    out.push_str("\nexport const HOST_FNS = [\n");
    for id in HOST_FNS {
        out.push_str("  '");
        out.push_str(id);
        out.push_str("',\n");
    }
    out.push_str("] as const\n\nexport type HostFn = (typeof HOST_FNS)[number]\n");
    for (const_name, section) in [
        ("GROUP_A_FNS", "Group A"),
        ("GROUP_B_FNS", "Group B"),
        ("GROUP_C_FNS", "Group C"),
        ("GROUP_MCP_FNS", "MCP composite"),
    ] {
        out.push_str("\nexport const ");
        out.push_str(const_name);
        out.push_str(" = [\n");
        for id in client_ids_in_section(ir, section) {
            out.push_str("  '");
            out.push_str(id);
            out.push_str("',\n");
        }
        out.push_str("] as const\n");
    }
    out.push_str("\n/** Sync decision and payload-builder ids, in emit order. */\n");
    out.push_str("export const FIXTURE_SYNC_FNS = [\n");
    for id in sync_fixture_ids(ir) {
        out.push_str("  '");
        out.push_str(id);
        out.push_str("',\n");
    }
    out.push_str("] as const\n");
    Ok(out)
}

fn sync_fixture_ids(ir: &Ir) -> Vec<&str> {
    let mut symbols: Vec<_> = ir
        .binding_symbols
        .values()
        .filter(|sym| {
            matches!(
                sym.artifact,
                IrBindingArtifact::Decisions | IrBindingArtifact::PayloadBuilders
            )
        })
        .collect();
    symbols.sort_by_key(|sym| {
        let rank = match sym.artifact {
            IrBindingArtifact::Decisions => 0,
            IrBindingArtifact::PayloadBuilders => 1,
            IrBindingArtifact::Client | IrBindingArtifact::Webhook => 2,
        };
        (rank, sym.emit_order, sym.id.as_str())
    });
    symbols.into_iter().map(|sym| sym.id.as_str()).collect()
}

fn client_ids_in_section<'a>(ir: &'a Ir, section: &str) -> Vec<&'a str> {
    let mut symbols: Vec<_> = ir
        .binding_symbols
        .values()
        .filter(|sym| {
            sym.artifact == IrBindingArtifact::Client && sym.section.as_deref() == Some(section)
        })
        .collect();
    symbols.sort_by_key(|sym| (sym.emit_order, sym.id.as_str()));
    symbols.into_iter().map(|sym| sym.id.as_str()).collect()
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
