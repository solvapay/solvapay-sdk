//! Shared IR → language-neutral doc lines for emitters (§5.6 / D19).
//!
//! TypeScript (`render_tsdoc`), Python (`render_pydoc`), and Ruby (`render_yard`)
//! all build from this shape: summary, then `@param` / `@returns` lines.
//! Surfaces wrap the lines in their native comment form (`/** */`, `"""…"""`,
//! `# …`); Ruby additionally maps `@returns` → `@return` for YARD.

use crate::ir::{IrEntryPoint, IrParam};

/// Builds summary / `@param` / `@returns` lines from the shared IR doc model.
///
/// `param_name` selects the language column for each parameter (`names.ts`,
/// `names.py`, …). Empty summary / param / returns fields are skipped.
pub fn render_entry_doc_lines(
    ep: &IrEntryPoint,
    param_name: impl Fn(&IrParam) -> &str,
) -> Vec<String> {
    let mut lines = Vec::new();
    let summary = ep.docs.summary.trim();
    if !summary.is_empty() {
        lines.push(summary.to_string());
    }
    for param in &ep.params {
        let doc = param.doc.trim();
        if doc.is_empty() {
            continue;
        }
        lines.push(format!("@param {} {doc}", param_name(param)));
    }
    if let Some(returns) = ep.docs.returns.as_deref() {
        let trimmed = returns.trim();
        if !trimmed.is_empty() {
            lines.push(format!("@returns {trimmed}"));
        }
    }
    lines
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
mod tests {
    use super::*;
    use crate::ir::{
        IrAvailability, IrDefaults, IrDocModel, IrEntrySection, IrErrorKind, IrLangNames,
        IrRubyReceiver, IrRubyTarget, IrSyncKind, IrTypeRef,
    };

    #[test]
    fn skips_empty_fields() {
        let ep = IrEntryPoint {
            id: "checkLimits".into(),
            section: IrEntrySection::Operation,
            names: IrLangNames {
                ts: "checkLimits".into(),
                py: "check_limits".into(),
                rb: "check_limits".into(),
                go: "CheckLimits".into(),
                rust: "check_limits".into(),
            },
            optional_on_client: false,
            params: vec![IrParam {
                name: "params".into(),
                names: IrLangNames {
                    ts: "params".into(),
                    py: "params".into(),
                    rb: "params".into(),
                    go: "params".into(),
                    rust: "params".into(),
                },
                required: true,
                ty: IrTypeRef::String,
                default_value: None,
                doc: "  ".into(),
            }],
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
                name: "check_limits".into(),
                receiver: IrRubyReceiver::ClientInstance,
                takes_block: false,
            },
            defaults: IrDefaults::default(),
            errors: vec![IrErrorKind::Api],
            docs: IrDocModel {
                summary: "Check limits.".into(),
                returns: Some("  ".into()),
            },
        };
        let lines = render_entry_doc_lines(&ep, |p| p.names.py.as_str());
        assert_eq!(lines, vec!["Check limits.".to_string()]);
    }
}
