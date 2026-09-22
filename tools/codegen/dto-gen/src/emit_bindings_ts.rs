//! Emit the native-side TypeScript marshalling glue (step 39G-c).
//!
//! Produces `packages/server/src/native.ts` (Node) and
//! `packages/server/src/wasm.ts` (edge) from the binding IR. The only
//! IR-derived content is the two method-name unions (`*ClientMethod` /
//! `*SyncMethod`); everything else is chrome loaded from
//! `assets/native-ts-emit.snapshot.json`.
//!
//! Output is prettier-shaped (2-space, single quotes) so `pnpm format:check`
//! stays green without a `.prettierignore` change.

use serde_json::Value;

use crate::chrome::{chrome_str, load_snapshot, partition_mcp, symbols_for};
use crate::emit_bindings_rs::Toolchain;
use crate::error::{GenError, GenResult};
use crate::header::{generated_header, CommentStyle};
use crate::ir::{Ir, IrBindingArtifact, IrBindingSymbol};

const SNAPSHOT: &str = include_str!("../assets/native-ts-emit.snapshot.json");

/// Emits `native.ts` (Node) or `wasm.ts` (Wasm) from the lowered IR.
///
/// # Errors
///
/// Returns [`GenError::Parse`] when the embedded chrome snapshot is missing an
/// expected field.
pub fn emit_native_ts(ir: &Ir, toolchain: Toolchain) -> GenResult<String> {
    let chrome: Value = load_snapshot(SNAPSHOT, "native-ts-emit snapshot")?;
    let (key, flag) = match toolchain {
        Toolchain::Node => ("native", "native-ts-out"),
        Toolchain::Wasm => ("wasm", "wasm-ts-out"),
        Toolchain::Python => {
            return Err(GenError::Parse(
                "emit_native_ts does not support Toolchain::Python (Step 41)".into(),
            ))
        }
        Toolchain::Ruby => {
            return Err(GenError::Parse(
                "emit_native_ts does not support Toolchain::Ruby (Step 43)".into(),
            ))
        }
        Toolchain::Go => {
            return Err(GenError::Parse(
                "emit_native_ts does not support Toolchain::Go (Step 49)".into(),
            ))
        }
        Toolchain::C => {
            return Err(GenError::Parse(
                "emit_native_ts does not support Toolchain::C".into(),
            ))
        }
    };
    let file = chrome
        .get("files")
        .and_then(|f| f.get(key))
        .ok_or_else(|| GenError::Parse(format!("snapshot missing files.{key}")))?;

    let preamble = chrome_str(file, &["preamble"], "native-ts")?;
    let bridge = chrome_str(file, &["clientToSyncBridge"], "native-ts")?;
    let core_comment = chrome_str(file, &["syncGroupComments", "core"], "native-ts")?;
    let mcp_comment = chrome_str(file, &["syncGroupComments", "mcp"], "native-ts")?;
    let source_label = match toolchain {
        Toolchain::Wasm => "WASM binding",
        _ => "native binding",
    };
    let (postamble, shared_envelope) =
        detach_envelope(chrome_str(file, &["postamble"], "native-ts")?, source_label);
    let envelope_import = if shared_envelope {
        "import { reconstructEnvelopeError, unwrapEnvelope } from './envelope.generated'\n\
         export { reconstructEnvelopeError }\n\n"
    } else {
        ""
    };

    let client_symbols: Vec<&IrBindingSymbol> = symbols_for(ir, IrBindingArtifact::Client);
    let client_union = render_union_members(client_symbols);
    let mut sync_union = render_sync_union(ir, core_comment, mcp_comment);
    if toolchain == Toolchain::Wasm {
        sync_union.push_str("\n  | 'solvapayCall'");
    }

    // Blank line after each union (prettier / committed style).
    let header = format!("{}\n", generated_header(CommentStyle::Block, flag));
    let mut src = format!(
        "{header}{envelope_import}{preamble}{client_union}\n\n{bridge}{sync_union}\n\n{postamble}"
    );
    if shared_envelope {
        src = strip_envelope_types(&src);
    }
    Ok(src)
}

/// Shared `reconstructEnvelopeError` / `unwrapEnvelope` module for native.ts and wasm.ts.
///
/// Parsing lives in `@solvapay/core`. This file only adds the Paywall branch.
pub fn emit_envelope_ts(_ir: &Ir) -> GenResult<String> {
    let mut out = generated_header(CommentStyle::Block, "ts-envelope-out");
    out.push_str(
        "\nimport {\n\
         \x20 reconstructSolvaPayEnvelopeError,\n\
         \x20 unwrapEnvelope as unwrapCoreEnvelope,\n\
         \x20 type EnvelopeError,\n\
         } from '@solvapay/core'\n\
         import { PaywallError } from './paywall'\n\
         import type { PaywallStructuredContent } from './types/paywall'\n\
         \n\
         export type { EnvelopeError }\n\
         \n\
         /** Maps a JSON envelope error to the frozen TypeScript error classes. */\n\
         export function reconstructEnvelopeError(error: EnvelopeError): Error {\n\
         \x20 if (error.kind === 'Paywall') {\n\
         \x20   return new PaywallError(error.message, error.gate as PaywallStructuredContent)\n\
         \x20 }\n\
         \x20 return reconstructSolvaPayEnvelopeError(error)\n\
         }\n\
         \n\
         /** Parses a JSON envelope string and returns `value` or throws reconstructed errors. */\n\
         export function unwrapEnvelope(envelopeJson: string, source: string): unknown {\n\
         \x20 return unwrapCoreEnvelope(envelopeJson, source, reconstructEnvelopeError)\n\
         }\n",
    );
    Ok(out)
}

fn strip_envelope_types(src: &str) -> String {
    let Some(start) = src.find("type EnvelopeOk =") else {
        return src.to_string();
    };
    let marker = "type Envelope = EnvelopeOk | EnvelopeErr\n";
    let Some(rel) = src[start..].find(marker) else {
        return src.to_string();
    };
    let mut end = start + rel + marker.len();
    while src[end..].starts_with('\n') {
        end += 1;
    }
    format!("{}{}", &src[..start], &src[end..])
}

fn detach_envelope(postamble: &str, source: &str) -> (String, bool) {
    let Some(start) = postamble.find("function isEnvelope(") else {
        return (postamble.to_string(), false);
    };
    let Some(rel) = postamble[start..].find("/**\n * Calls a") else {
        return (postamble.to_string(), false);
    };
    let mut kept = String::new();
    kept.push_str(&postamble[..start]);
    kept.push_str(&postamble[start + rel..]);
    let kept = kept.replace(
        "unwrapEnvelope(envelopeJson)",
        &format!("unwrapEnvelope(envelopeJson, '{source}')"),
    );
    (kept, true)
}

fn render_sync_union(ir: &Ir, core_comment: &str, mcp_comment: &str) -> String {
    let decisions = symbols_for(ir, IrBindingArtifact::Decisions);
    let payload = symbols_for(ir, IrBindingArtifact::PayloadBuilders);

    let mut lines: Vec<String> = Vec::new();
    for sym in &decisions {
        lines.push(union_member(&sym.names.ts));
    }

    let (core_syms, mcp_syms) = partition_mcp(payload);

    if !core_syms.is_empty() {
        lines.push(core_comment.to_string());
        for sym in &core_syms {
            lines.push(union_member(&sym.names.ts));
        }
    }

    if !mcp_syms.is_empty() {
        lines.push(mcp_comment.to_string());
        for sym in &mcp_syms {
            lines.push(union_member(&sym.names.ts));
        }
    }

    lines.join("\n")
}

fn render_union_members(symbols: Vec<&IrBindingSymbol>) -> String {
    let lines: Vec<String> = symbols.iter().map(|s| union_member(&s.names.ts)).collect();
    lines.join("\n")
}

fn union_member(ts_name: &str) -> String {
    format!("  | '{ts_name}'")
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
mod tests {
    use super::*;
    use crate::chrome::MCP_SECTION;
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
            defaults: Default::default(),
            driver_loops: Default::default(),
        }
    }

    fn sym(
        id: &str,
        artifact: IrBindingArtifact,
        emit_order: u32,
        section: Option<&str>,
    ) -> IrBindingSymbol {
        IrBindingSymbol {
            id: id.into(),
            core: format!("core::{id}"),
            names: IrLangNames {
                ts: id.into(),
                py: id.into(),
                rb: id.into(),
                go: id.into(),
                rust: id.into(),
                c: id.into(),
            },
            catalog: IrBindingCatalogLink::None,
            args: vec![],
            split_path_refs: vec![],
            return_shape: "value".into(),
            sync: IrSyncKind::Sync,
            envelope: IrEnvelopeMode::Sync,
            artifact,
            emit_order,
            section: section.map(str::to_owned),
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
    fn union_member_uses_prettier_single_quotes() {
        assert_eq!(union_member("createCustomer"), "  | 'createCustomer'");
    }

    #[test]
    fn sync_union_injects_group_comments_at_boundaries() {
        let mut ir = empty_ir();
        ir.binding_symbols.insert(
            "classifyCustomerRef".into(),
            sym("classifyCustomerRef", IrBindingArtifact::Decisions, 0, None),
        );
        ir.binding_symbols.insert(
            "validateBusinessDetails".into(),
            sym(
                "validateBusinessDetails",
                IrBindingArtifact::PayloadBuilders,
                0,
                Some("business-details"),
            ),
        );
        ir.binding_symbols.insert(
            "paywallToolResult".into(),
            sym(
                "paywallToolResult",
                IrBindingArtifact::PayloadBuilders,
                1,
                Some(MCP_SECTION),
            ),
        );

        let out = render_sync_union(&ir, "  // core comment", "  // mcp comment");
        assert_eq!(
            out,
            "  | 'classifyCustomerRef'\n  // core comment\n  | 'validateBusinessDetails'\n  // mcp comment\n  | 'paywallToolResult'"
        );
    }

    #[test]
    fn node_vs_wasm_chrome_comments_differ() {
        let mut ir = empty_ir();
        ir.binding_symbols.insert("createCustomer".into(), {
            let mut s = sym("createCustomer", IrBindingArtifact::Client, 0, None);
            s.sync = IrSyncKind::Async;
            s.envelope = IrEnvelopeMode::Async;
            s
        });
        ir.binding_symbols.insert(
            "classifyCustomerRef".into(),
            sym("classifyCustomerRef", IrBindingArtifact::Decisions, 0, None),
        );
        ir.binding_symbols.insert(
            "validateBusinessDetails".into(),
            sym(
                "validateBusinessDetails",
                IrBindingArtifact::PayloadBuilders,
                0,
                Some("business-details"),
            ),
        );
        ir.binding_symbols.insert(
            "paywallToolResult".into(),
            sym(
                "paywallToolResult",
                IrBindingArtifact::PayloadBuilders,
                1,
                Some(MCP_SECTION),
            ),
        );

        let node = emit_native_ts(&ir, Toolchain::Node).unwrap();
        let wasm = emit_native_ts(&ir, Toolchain::Wasm).unwrap();
        assert!(node.contains("@generated by dto-gen"));
        assert!(wasm.contains("@generated by dto-gen"));
        assert!(node.contains("  // Step 37R-d — @solvapay/core pure logic"));
        assert!(wasm.contains("  // @solvapay/core pure logic"));
        assert!(!wasm.contains("Step 37R-d — @solvapay/core"));
    }

    #[test]
    fn client_symbols_sorted_by_emit_order() {
        let mut ir = empty_ir();
        ir.binding_symbols.insert(
            "zebra".into(),
            sym("zebra", IrBindingArtifact::Client, 2, None),
        );
        ir.binding_symbols.insert(
            "alpha".into(),
            sym("alpha", IrBindingArtifact::Client, 0, None),
        );
        ir.binding_symbols.insert(
            "beta".into(),
            sym("beta", IrBindingArtifact::Client, 1, None),
        );
        assert_eq!(
            render_union_members(symbols_for(&ir, IrBindingArtifact::Client)),
            "  | 'alpha'\n  | 'beta'\n  | 'zebra'"
        );
    }
}
