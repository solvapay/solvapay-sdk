//! Lower `errors:` + per-operation error templates from the manifest into IR.

use crate::error::GenResult;
use crate::ir::{Ir, IrErrorTemplates, IrOperationErrorTemplates};
use crate::manifest::Manifest;

/// Copies frozen error templates from the manifest into `ir.error_templates`.
///
/// # Errors
///
/// Currently infallible; returns [`GenResult`] for symmetry with overlay lowering.
pub fn lower_errors(ir: &mut Ir, manifest: &Manifest) -> GenResult<()> {
    let mut templates = IrErrorTemplates::default();

    if let Some(errors) = &manifest.errors {
        templates.webhook_messages = errors.webhook.messages.clone();
        templates.paywall_messages = errors.paywall.messages.clone();
        templates.transport_template = errors.transport.message_template.clone();
    }

    for (op_id, op) in &manifest.operations {
        templates.operations.insert(
            op_id.clone(),
            IrOperationErrorTemplates {
                default_template: op.errors.default.message_template.clone(),
                cases: op
                    .errors
                    .cases
                    .iter()
                    .map(|c| c.message_template.clone())
                    .collect(),
            },
        );
    }

    ir.error_templates = templates;
    Ok(())
}
