//! Emit the Python native-side marshalling glue (step 41-c).
//!
//! Produces `sdks/python/python/solvapay/_native.py` from the binding
//! IR. IR-derived content is the two method-name literals (`ClientMethod` /
//! `SyncMethod`) plus optional frozenset mirrors; loader / envelope chrome is
//! verbatim from `assets/native-py-emit.snapshot.json`.

use serde_json::Value;

use crate::chrome::{chrome_str, load_snapshot, partition_mcp, symbols_for};
use crate::error::{GenError, GenResult};
use crate::header::{generated_header, CommentStyle};
use crate::ir::{Ir, IrBindingArtifact, IrBindingSymbol};

const SNAPSHOT: &str = include_str!("../assets/native-py-emit.snapshot.json");

/// Emits `solvapay/_native.py` from the lowered IR.
///
/// # Errors
///
/// Returns [`GenError::Parse`] when the embedded chrome snapshot is missing an
/// expected field.
pub fn emit_native_py(ir: &Ir) -> GenResult<String> {
    let chrome: Value = load_snapshot(SNAPSHOT, "native-py-emit snapshot")?;
    let file = chrome
        .get("files")
        .and_then(|f| f.get("native"))
        .ok_or_else(|| GenError::Parse("snapshot missing files.native".into()))?;

    let preamble = chrome_str(file, &["preamble"], "native-py")?;
    let bridge = chrome_str(file, &["clientToSyncBridge"], "native-py")?;
    let core_comment = chrome_str(file, &["syncGroupComments", "core"], "native-py")?;
    let mcp_comment = chrome_str(file, &["syncGroupComments", "mcp"], "native-py")?;
    let postamble = chrome_str(file, &["postamble"], "native-py")?;

    let client_literal = render_literal_members(symbols_for(ir, IrBindingArtifact::Client));
    let sync_literal = render_sync_literal(ir, core_comment, mcp_comment);

    Ok(format!(
        "{}{}{}{}{}{}",
        format!(
            "{}\n",
            generated_header(CommentStyle::Hash, "native-py-out")
        ),
        preamble,
        client_literal,
        bridge,
        sync_literal,
        postamble
    ))
}

fn render_sync_literal(ir: &Ir, core_comment: &str, mcp_comment: &str) -> String {
    let decisions = symbols_for(ir, IrBindingArtifact::Decisions);
    let payload = symbols_for(ir, IrBindingArtifact::PayloadBuilders);

    let mut lines: Vec<String> = Vec::new();
    for sym in &decisions {
        lines.push(literal_member(&sym.names.py));
    }

    let (core_syms, mcp_syms) = partition_mcp(payload);

    if !core_syms.is_empty() {
        lines.push(core_comment.to_string());
        for sym in &core_syms {
            lines.push(literal_member(&sym.names.py));
        }
    }

    if !mcp_syms.is_empty() {
        lines.push(mcp_comment.to_string());
        for sym in &mcp_syms {
            lines.push(literal_member(&sym.names.py));
        }
    }

    lines.join("\n")
}

fn render_literal_members(symbols: Vec<&IrBindingSymbol>) -> String {
    symbols
        .iter()
        .map(|s| literal_member(&s.names.py))
        .collect::<Vec<_>>()
        .join("\n")
}

fn literal_member(py_name: &str) -> String {
    format!("    \"{py_name}\",")
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
mod tests {
    use super::*;
    use crate::ir::{
        IrBindingCall, IrBindingCatalogLink, IrEnvelopeMode, IrLangNames, IrSerializeKind,
        IrSyncKind,
    };
    use std::collections::BTreeMap;

    fn empty_ir() -> Ir {
        Ir {
            types: BTreeMap::new(),
            overlay_helpers: BTreeMap::new(),
            overlays: BTreeMap::new(),
            routes: vec![],
            error_templates: crate::ir::IrErrorTemplates::default(),
            entry_points: BTreeMap::new(),
            binding_symbols: BTreeMap::new(),
            core_types: BTreeMap::new(),
            core_types_ts: Default::default(),
            core_fns: Default::default(),
            transport_fns: Default::default(),
        }
    }

    fn sym(id: &str, artifact: IrBindingArtifact, emit_order: u32) -> IrBindingSymbol {
        IrBindingSymbol {
            id: id.into(),
            core: format!("core::{id}"),
            names: IrLangNames {
                ts: id.into(),
                py: id.into(),
                rb: id.into(),
                go: id.into(),
                rust: id.into(),
            },
            catalog: IrBindingCatalogLink::None,
            args: vec![],
            split_path_refs: vec![],
            return_shape: "value".into(),
            sync: IrSyncKind::Sync,
            envelope: IrEnvelopeMode::Sync,
            artifact,
            emit_order,
            section: None,
            doc: String::new(),
            doc_wasm: None,
            rust_fn_name: id.into(),
            call: IrBindingCall::Wrap {
                serialize: IrSerializeKind::ToValue,
                args: vec![],
            },
            verbatim_body: None,
            verbatim_body_wasm: None,
            dto_type: None,
            core_call: None,
            client_call_args: vec![],
            ts_wrapper: None,
        }
    }

    #[test]
    fn snapshot_loads_and_emits_header() {
        let ir = empty_ir();
        let out = emit_native_py(&ir).unwrap();
        assert!(out.starts_with("# @generated by dto-gen"));
        assert!(out.contains("ClientMethod = Literal["));
        assert!(out.contains("SyncMethod = Literal["));
    }

    #[test]
    fn client_and_sync_literals_follow_emit_order() {
        let mut ir = empty_ir();
        ir.binding_symbols
            .insert("b".into(), sym("beta_client", IrBindingArtifact::Client, 2));
        ir.binding_symbols.insert(
            "a".into(),
            sym("alpha_client", IrBindingArtifact::Client, 1),
        );
        ir.binding_symbols.insert(
            "d".into(),
            sym("delta_sync", IrBindingArtifact::Decisions, 2),
        );
        ir.binding_symbols.insert(
            "c".into(),
            sym("charlie_sync", IrBindingArtifact::Decisions, 1),
        );
        let out = emit_native_py(&ir).unwrap();
        let client_pos = out.find("\"alpha_client\",").unwrap();
        let client_pos2 = out.find("\"beta_client\",").unwrap();
        assert!(client_pos < client_pos2);
        let sync_pos = out.find("\"charlie_sync\",").unwrap();
        let sync_pos2 = out.find("\"delta_sync\",").unwrap();
        assert!(sync_pos < sync_pos2);
    }
}
