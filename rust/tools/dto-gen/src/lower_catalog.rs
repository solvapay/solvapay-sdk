//! Lower catalog entry points (operations / topLevel / facade / coreHelpers) into IR.

use crate::error::GenResult;
use crate::ir::{Ir, IrEntryPoint, IrEntrySection, IrLangNames, IrParam, IrSyncKind};
use crate::lower_overlays::lower_type_ref;
use crate::manifest::{LangNames, Manifest, NamedEntry, OperationDef, ParamDef};

/// Populates `ir.entry_points` from the contract manifest catalog.
///
/// # Errors
///
/// Returns type-lowering errors when a param type cannot be resolved.
pub fn lower_catalog(ir: &mut Ir, manifest: &Manifest) -> GenResult<()> {
    for (id, op) in &manifest.operations {
        let entry = lower_operation(ir, id, op)?;
        ir.entry_points.insert(id.clone(), entry);
    }
    for (id, entry) in &manifest.top_level {
        let ep = lower_named(ir, id, entry, IrEntrySection::TopLevel)?;
        ir.entry_points.insert(id.clone(), ep);
    }
    for (id, entry) in &manifest.core_helpers {
        let ep = lower_named(ir, id, entry, IrEntrySection::CoreHelper)?;
        ir.entry_points.insert(id.clone(), ep);
    }
    for (id, entry) in &manifest.facade {
        let ep = lower_named(ir, id, entry, IrEntrySection::Facade)?;
        ir.entry_points.insert(id.clone(), ep);
    }
    Ok(())
}

fn lower_operation(ir: &mut Ir, id: &str, op: &OperationDef) -> GenResult<IrEntryPoint> {
    let names = op.names.clone().unwrap_or_else(|| default_names(id));
    let params = lower_params(ir, id, &op.params)?;
    Ok(IrEntryPoint {
        id: id.to_string(),
        section: IrEntrySection::Operation,
        names: to_ir_names(names),
        optional_on_client: op.optional_on_client,
        params,
        type_params: vec![],
        request: op.request.clone(),
        response: op.response.clone(),
        sync_ts: sync_ts_from_value(&op.sync),
    })
}

fn lower_named(
    ir: &mut Ir,
    id: &str,
    entry: &NamedEntry,
    section: IrEntrySection,
) -> GenResult<IrEntryPoint> {
    let params = lower_params(ir, id, &entry.params)?;
    Ok(IrEntryPoint {
        id: id.to_string(),
        section,
        names: to_ir_names(entry.names.clone()),
        optional_on_client: false,
        params,
        type_params: entry.type_params.iter().map(|t| t.name.clone()).collect(),
        request: None,
        response: None,
        sync_ts: sync_ts_from_value(&entry.sync),
    })
}

fn lower_params(ir: &mut Ir, parent: &str, params: &[ParamDef]) -> GenResult<Vec<IrParam>> {
    let mut out = Vec::new();
    for param in params {
        let field = param.as_field_def();
        let ty = lower_type_ref(ir, parent, &param.name, &field)?;
        out.push(IrParam {
            name: param.name.clone(),
            required: param.required,
            ty,
            default_value: param.default_value.clone(),
            doc: param.doc.clone().unwrap_or_default(),
        });
    }
    Ok(out)
}

fn to_ir_names(names: LangNames) -> IrLangNames {
    IrLangNames {
        ts: names.ts,
        py: names.py,
        rb: names.rb,
        go: names.go,
        rust: names.rust,
    }
}

fn default_names(id: &str) -> LangNames {
    let snake = to_snake(id);
    let mut chars = id.chars();
    let pascal = match chars.next() {
        Some(c) => c.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    };
    LangNames {
        ts: id.to_string(),
        py: snake.clone(),
        rb: snake.clone(),
        go: pascal,
        rust: snake,
    }
}

fn to_snake(id: &str) -> String {
    let mut out = String::new();
    for (i, c) in id.chars().enumerate() {
        if c.is_uppercase() {
            if i > 0 {
                out.push('_');
            }
            out.extend(c.to_lowercase());
        } else {
            out.push(c);
        }
    }
    out
}

fn sync_ts_from_value(value: &serde_json::Value) -> IrSyncKind {
    match value.get("ts").and_then(|v| v.as_str()) {
        Some("sync") => IrSyncKind::Sync,
        _ => IrSyncKind::Async,
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
mod tests {
    use super::*;
    use crate::manifest::{MessageTemplate, OperationErrors};
    use std::collections::BTreeMap;

    fn empty_ir() -> Ir {
        Ir {
            types: BTreeMap::new(),
            overlay_helpers: BTreeMap::new(),
            overlays: BTreeMap::new(),
            routes: vec![],
            error_templates: crate::ir::IrErrorTemplates::default(),
            entry_points: BTreeMap::new(),
        }
    }

    #[test]
    fn lowers_update_customer_params() {
        let yaml = r#"
operations:
  updateCustomer:
    names:
      ts: updateCustomer
      py: update_customer
      rb: update_customer
      go: UpdateCustomer
      rust: update_customer
    optionalOnClient: true
    response: UpdateCustomerResult
    params:
      - name: customerRef
        type: string
        required: true
      - name: params
        ref: UpdateCustomerParams
        required: true
    sync:
      ts: async
    errors:
      default:
        messageTemplate: "x"
"#;
        let manifest: Manifest = serde_norway::from_str(yaml).unwrap();
        let mut ir = empty_ir();
        lower_catalog(&mut ir, &manifest).unwrap();
        let ep = ir.entry_points.get("updateCustomer").unwrap();
        assert_eq!(ep.params.len(), 2);
        assert_eq!(ep.params[0].name, "customerRef");
        assert_eq!(ep.params[1].name, "params");
        assert!(ep.optional_on_client);
        assert_eq!(ep.sync_ts, IrSyncKind::Async);
    }

    #[test]
    fn lowers_with_retry_type_params() {
        let yaml = r#"
topLevel:
  withRetry:
    names:
      ts: withRetry
      py: with_retry
      rb: with_retry
      go: WithRetry
      rust: with_retry
    sync:
      ts: sync
    typeParams:
      - name: T
    params:
      - name: fn
        type: unknown
        required: true
"#;
        let manifest: Manifest = serde_norway::from_str(yaml).unwrap();
        let mut ir = empty_ir();
        lower_catalog(&mut ir, &manifest).unwrap();
        let ep = ir.entry_points.get("withRetry").unwrap();
        assert_eq!(ep.type_params, vec!["T".to_string()]);
        assert_eq!(ep.sync_ts, IrSyncKind::Sync);
        assert_eq!(ep.section, IrEntrySection::TopLevel);
    }

    #[test]
    fn default_names_helper_covers_missing_names_block() {
        let mut ir = empty_ir();
        let mut ops = BTreeMap::new();
        ops.insert(
            "checkLimits".into(),
            OperationDef {
                names: None,
                optional_on_client: false,
                request: None,
                response: Some("LimitResponse".into()),
                params: vec![],
                sync: serde_json::json!({ "ts": "async" }),
                errors: OperationErrors {
                    default: MessageTemplate {
                        message_template: "x".into(),
                    },
                    cases: vec![],
                },
            },
        );
        let manifest = Manifest {
            operations: ops,
            overlays: BTreeMap::new(),
            errors: None,
            top_level: BTreeMap::new(),
            core_helpers: BTreeMap::new(),
            facade: BTreeMap::new(),
        };
        lower_catalog(&mut ir, &manifest).unwrap();
        assert_eq!(
            ir.entry_points.get("checkLimits").unwrap().names.ts,
            "checkLimits"
        );
    }
}
