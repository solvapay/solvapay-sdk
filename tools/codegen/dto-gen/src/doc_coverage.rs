//! Doc-comment coverage checker (§5.6 / D19 / step 18T).
//!
//! Surface-agnostic: every catalogued entry point in the IR must carry a
//! non-empty `docs.summary`. Emitters (TS / Python / Ruby / Rust / Go) reuse
//! this gate; only the language column differs later.

use crate::error::{GenError, GenResult};
use crate::ir::Ir;

/// Ensures every catalogued entry point has a non-empty trimmed summary.
///
/// # Errors
///
/// Returns [`GenError::DocCoverage`] listing every uncovered entry-point id
/// (sorted) when any summary is missing or whitespace-only.
pub fn check_doc_coverage(ir: &Ir) -> GenResult<()> {
    let mut missing: Vec<&str> = ir
        .entry_points
        .iter()
        .filter(|(_, ep)| ep.docs.summary.trim().is_empty())
        .map(|(id, _)| id.as_str())
        .collect();
    missing.sort_unstable();
    if missing.is_empty() {
        return Ok(());
    }
    Err(GenError::DocCoverage {
        missing: missing.into_iter().map(str::to_string).collect(),
    })
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
mod tests {
    use super::*;
    use crate::ir::{
        IrAvailability, IrDefaults, IrDocModel, IrEntryPoint, IrEntrySection, IrErrorKind,
        IrLangNames, IrRubyReceiver, IrRubyTarget, IrSyncKind,
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
        }
    }

    fn entry(id: &str, summary: &str) -> IrEntryPoint {
        IrEntryPoint {
            id: id.into(),
            section: IrEntrySection::Operation,
            names: IrLangNames {
                ts: id.into(),
                py: id.into(),
                rb: id.into(),
                go: id.into(),
                rust: id.into(),
            },
            optional_on_client: false,
            params: vec![],
            type_params: vec![],
            request: None,
            response: None,
            availability: IrAvailability {
                ts: vec![IrSyncKind::Async],
                py: vec![IrSyncKind::Async],
                rb: vec![IrSyncKind::Sync],
                go: vec![IrSyncKind::Sync],
                rust: vec![IrSyncKind::Async],
            },
            sync_ts: IrSyncKind::Async,
            ruby_target: IrRubyTarget {
                owner: "SolvaPay::Client".into(),
                name: id.into(),
                receiver: IrRubyReceiver::ClientInstance,
                takes_block: false,
            },
            defaults: IrDefaults::default(),
            errors: vec![IrErrorKind::Api],
            docs: IrDocModel {
                summary: summary.into(),
                returns: None,
            },
        }
    }

    #[test]
    fn rejects_entry_point_missing_summary() {
        let mut ir = empty_ir();
        ir.entry_points
            .insert("checkLimits".into(), entry("checkLimits", ""));
        ir.entry_points
            .insert("withRetry".into(), entry("withRetry", "Retry a callable."));
        let err = check_doc_coverage(&ir).expect_err("missing summary");
        let msg = err.to_string();
        assert!(msg.contains("checkLimits"), "{msg}");
        assert!(!msg.contains("withRetry"), "{msg}");
    }

    #[test]
    fn accepts_all_summarized_entry_points() {
        let mut ir = empty_ir();
        ir.entry_points.insert(
            "checkLimits".into(),
            entry("checkLimits", "Check remaining limits."),
        );
        ir.entry_points.insert(
            "withRetry".into(),
            entry("withRetry", "Retry an async callable."),
        );
        check_doc_coverage(&ir).expect("all summaries present");
    }

    #[test]
    fn rejects_whitespace_only_summary() {
        let mut ir = empty_ir();
        ir.entry_points
            .insert("gate".into(), entry("gate", "   \n\t  "));
        let err = check_doc_coverage(&ir).expect_err("whitespace summary");
        assert!(err.to_string().contains("gate"));
    }
}
