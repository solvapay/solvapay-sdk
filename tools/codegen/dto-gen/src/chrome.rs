//! Shared snapshot-chrome helpers for hybrid emitters.

use serde_json::Value;

use crate::error::{GenError, GenResult};
use crate::ir::{Ir, IrBindingArtifact, IrBindingSymbol};

/// Section id whose payload-builder symbols sit under the mcp-core group comment.
pub(crate) const MCP_SECTION: &str = "MCP payload / descriptors";

/// Parse an embedded chrome snapshot and fail loudly on invalid JSON.
///
/// # Errors
///
/// Returns [`GenError::Parse`] when `raw` is not JSON.
pub(crate) fn load_snapshot(raw: &str, label: &str) -> GenResult<Value> {
    serde_json::from_str(raw).map_err(|e| GenError::Parse(format!("invalid {label}: {e}")))
}

/// Walk `path` on a JSON object and require a string leaf.
///
/// # Errors
///
/// Returns [`GenError::Parse`] when a key is missing or the leaf is not a string.
pub(crate) fn chrome_str<'a>(art: &'a Value, path: &[&str], label: &str) -> GenResult<&'a str> {
    let mut cur = art;
    for key in path {
        cur = cur
            .get(*key)
            .ok_or_else(|| GenError::Parse(format!("{label} missing {}", path.join("."))))?;
    }
    cur.as_str()
        .ok_or_else(|| GenError::Parse(format!("{label} {} is not a string", path.join("."))))
}

/// Binding symbols for `artifact`, sorted by emit order then id.
pub(crate) fn symbols_for(ir: &Ir, artifact: IrBindingArtifact) -> Vec<&IrBindingSymbol> {
    let mut out: Vec<&IrBindingSymbol> = ir
        .binding_symbols
        .values()
        .filter(|s| s.artifact == artifact)
        .collect();
    out.sort_by(|a, b| a.emit_order.cmp(&b.emit_order).then(a.id.cmp(&b.id)));
    out
}

/// Split payload-builder symbols into core vs MCP-section groups.
pub(crate) fn partition_mcp(
    symbols: Vec<&IrBindingSymbol>,
) -> (Vec<&IrBindingSymbol>, Vec<&IrBindingSymbol>) {
    symbols
        .into_iter()
        .partition(|s| s.section.as_deref() != Some(MCP_SECTION))
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
mod tests {
    use super::*;
    use crate::ir::{
        Ir, IrBindingCall, IrBindingCatalogLink, IrEnvelopeMode, IrLangNames, IrSerializeKind,
        IrSyncKind,
    };

    fn sym(
        id: &str,
        artifact: IrBindingArtifact,
        order: u32,
        section: Option<&str>,
    ) -> IrBindingSymbol {
        IrBindingSymbol {
            id: id.into(),
            core: String::new(),
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
            emit_order: order,
            section: section.map(str::to_string),
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
    fn load_snapshot_and_chrome_str() {
        let v = load_snapshot(r#"{"files":{"native":{"preamble":"hi"}}}"#, "t").unwrap();
        assert_eq!(
            chrome_str(&v, &["files", "native", "preamble"], "t").unwrap(),
            "hi"
        );
        assert!(chrome_str(&v, &["missing"], "t").is_err());
    }

    #[test]
    fn symbols_for_sorts_and_partition_mcp_splits() {
        let mut ir = Ir::default();
        ir.binding_symbols.insert(
            "b".into(),
            sym(
                "b",
                IrBindingArtifact::PayloadBuilders,
                2,
                Some(MCP_SECTION),
            ),
        );
        ir.binding_symbols.insert(
            "a".into(),
            sym("a", IrBindingArtifact::PayloadBuilders, 1, None),
        );
        ir.binding_symbols
            .insert("c".into(), sym("c", IrBindingArtifact::Client, 0, None));
        let payload = symbols_for(&ir, IrBindingArtifact::PayloadBuilders);
        assert_eq!(
            payload.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(),
            ["a", "b"]
        );
        let (core, mcp) = partition_mcp(payload);
        assert_eq!(core[0].id, "a");
        assert_eq!(mcp[0].id, "b");
        assert_eq!(symbols_for(&ir, IrBindingArtifact::Client).len(), 1);
    }
}
