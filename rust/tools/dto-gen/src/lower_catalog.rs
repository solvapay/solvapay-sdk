//! Lower catalog entry points (operations / topLevel / facade / coreHelpers) into IR.

use std::collections::BTreeSet;

use crate::error::{GenError, GenResult};
use crate::ir::{
    Ir, IrAvailability, IrDefaults, IrDocModel, IrEntryPoint, IrEntrySection, IrErrorKind,
    IrLangNames, IrParam, IrRubyReceiver, IrRubyTarget, IrSyncKind,
};
use crate::lower_overlays::lower_type_ref;
use crate::manifest::{DocsDef, LangNames, Manifest, NamedEntry, OperationDef, ParamDef};

/// Populates `ir.entry_points` from the contract manifest catalog.
///
/// # Errors
///
/// Returns type-lowering errors when a param type cannot be resolved.
pub fn lower_catalog(ir: &mut Ir, manifest: &Manifest) -> GenResult<()> {
    for (id, op) in &manifest.operations {
        let entry = lower_operation(ir, id, op, &manifest.defaults)?;
        ir.entry_points.insert(id.clone(), entry);
    }
    for (id, entry) in &manifest.top_level {
        let ep = lower_named(ir, id, entry, IrEntrySection::TopLevel, &manifest.defaults)?;
        ir.entry_points.insert(id.clone(), ep);
    }
    for (id, entry) in &manifest.core_helpers {
        let ep = lower_named(
            ir,
            id,
            entry,
            IrEntrySection::CoreHelper,
            &manifest.defaults,
        )?;
        ir.entry_points.insert(id.clone(), ep);
    }
    for (id, entry) in &manifest.facade {
        let ep = lower_named(ir, id, entry, IrEntrySection::Facade, &manifest.defaults)?;
        ir.entry_points.insert(id.clone(), ep);
    }
    validate_ruby_catalog(&ir.entry_points)?;
    Ok(())
}

fn lower_operation(
    ir: &mut Ir,
    id: &str,
    op: &OperationDef,
    defaults: &crate::manifest::DefaultsDef,
) -> GenResult<IrEntryPoint> {
    let names = op.names.clone().unwrap_or_else(|| default_names(id));
    let params = lower_params(ir, id, &op.params, &op.docs)?;
    let names = to_ir_names(names);
    let availability = availability_from_value(id, &op.sync)?;
    let sync_ts = availability
        .ts
        .first()
        .copied()
        .unwrap_or(IrSyncKind::Async);
    Ok(IrEntryPoint {
        id: id.to_string(),
        section: IrEntrySection::Operation,
        ruby_target: ruby_target(id, IrEntrySection::Operation, &names.rb)?,
        names,
        optional_on_client: op.optional_on_client,
        params,
        type_params: vec![],
        request: op.request.clone(),
        response: op.response.clone(),
        availability,
        sync_ts,
        defaults: defaults_from_manifest(defaults),
        errors: all_error_kinds(),
        docs: lower_docs(&op.docs),
    })
}

fn lower_named(
    ir: &mut Ir,
    id: &str,
    entry: &NamedEntry,
    section: IrEntrySection,
    defaults: &crate::manifest::DefaultsDef,
) -> GenResult<IrEntryPoint> {
    let params = lower_params(ir, id, &entry.params, &entry.docs)?;
    let names = to_ir_names(entry.names.clone());
    let availability = availability_from_value(id, &entry.sync)?;
    let sync_ts = availability
        .ts
        .first()
        .copied()
        .unwrap_or(IrSyncKind::Async);
    Ok(IrEntryPoint {
        id: id.to_string(),
        section,
        ruby_target: ruby_target(id, section, &names.rb)?,
        names,
        optional_on_client: false,
        params,
        type_params: entry.type_params.iter().map(|t| t.name.clone()).collect(),
        request: None,
        response: None,
        availability,
        sync_ts,
        defaults: defaults_from_manifest(defaults),
        errors: all_error_kinds(),
        docs: lower_docs(&entry.docs),
    })
}

/// Maps manifest `docs:` into the IR doc model (shared by operations + named entries).
fn lower_docs(docs: &DocsDef) -> IrDocModel {
    IrDocModel {
        summary: docs.summary.clone().unwrap_or_default(),
        returns: docs.returns.clone(),
    }
}

fn lower_params(
    ir: &mut Ir,
    parent: &str,
    params: &[ParamDef],
    docs: &DocsDef,
) -> GenResult<Vec<IrParam>> {
    let mut out = Vec::new();
    for param in params {
        let field = param.as_field_def();
        let ty = lower_type_ref(ir, parent, &param.name, &field)?;
        let snake = to_snake(&param.name);
        // Manifest `docs.params.<name>` wins over inline `params[].doc` when both exist.
        let doc = docs
            .params
            .get(&param.name)
            .cloned()
            .or_else(|| param.doc.clone())
            .unwrap_or_default();
        out.push(IrParam {
            name: param.name.clone(),
            names: IrLangNames {
                ts: param.name.clone(),
                py: snake.clone(),
                rb: snake.clone(),
                go: param.name.clone(),
                rust: snake,
            },
            required: param.required,
            ty,
            default_value: param.default_value.clone(),
            doc,
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

fn availability_from_value(id: &str, value: &serde_json::Value) -> GenResult<IrAvailability> {
    Ok(IrAvailability {
        ts: language_modes(id, "TypeScript", value.get("ts"))?,
        py: language_modes(id, "Python", value.get("py"))?,
        rb: language_modes(id, "Ruby", value.get("rb"))?,
        go: language_modes(id, "Go", value.get("go"))?,
        rust: language_modes(id, "Rust", value.get("rust"))?,
    })
}

fn language_modes(
    id: &str,
    language: &str,
    value: Option<&serde_json::Value>,
) -> GenResult<Vec<IrSyncKind>> {
    let value = value
        .ok_or_else(|| GenError::Parse(format!("{id}: missing {language} sync availability")))?;
    let raw = match value {
        serde_json::Value::String(mode) => vec![mode.as_str()],
        serde_json::Value::Array(modes) => modes
            .iter()
            .map(|mode| {
                mode.as_str().ok_or_else(|| {
                    GenError::Parse(format!("{id}: invalid {language} sync availability"))
                })
            })
            .collect::<GenResult<Vec<_>>>()?,
        _ => {
            return Err(GenError::Parse(format!(
                "{id}: invalid {language} sync availability"
            )))
        }
    };
    raw.into_iter()
        .map(|mode| match mode {
            "async" => Ok(IrSyncKind::Async),
            "sync" | "blocking" => Ok(IrSyncKind::Sync),
            other => Err(GenError::Parse(format!(
                "{id}: unsupported {language} receiver/sync mode {other}"
            ))),
        })
        .collect()
}

fn ruby_target(id: &str, section: IrEntrySection, ruby_name: &str) -> GenResult<IrRubyTarget> {
    let (owner, name, receiver) = match section {
        IrEntrySection::Operation => (
            "SolvaPay::Client",
            ruby_name,
            IrRubyReceiver::ClientInstance,
        ),
        IrEntrySection::CoreHelper
            if ruby_name
                .chars()
                .all(|c| c.is_ascii_uppercase() || c == '_') =>
        {
            ("SolvaPay", ruby_name, IrRubyReceiver::Constant)
        }
        IrEntrySection::TopLevel if id == "SolvaPayError" || id == "PaywallError" => {
            ("SolvaPay", ruby_name, IrRubyReceiver::ErrorClass)
        }
        IrEntrySection::Facade if ruby_name == "SolvaPay.create" => {
            ("SolvaPay", "create", IrRubyReceiver::ModuleFunction)
        }
        IrEntrySection::Facade if ruby_name == "sp.gate" => {
            ("SolvaPay::Facade", "gate", IrRubyReceiver::FacadeInstance)
        }
        IrEntrySection::Facade if !ruby_name.contains('.') => (
            "SolvaPay::Facade",
            ruby_name,
            IrRubyReceiver::FacadeInstance,
        ),
        IrEntrySection::TopLevel | IrEntrySection::CoreHelper if !ruby_name.contains('.') => {
            ("SolvaPay", ruby_name, IrRubyReceiver::ModuleFunction)
        }
        _ => {
            return Err(GenError::Parse(format!(
                "{id}: unsupported Ruby receiver syntax {ruby_name}"
            )))
        }
    };
    Ok(IrRubyTarget {
        owner: owner.into(),
        name: name.into(),
        receiver,
        takes_block: id == "protect" || id == "withRetry",
    })
}

fn defaults_from_manifest(defaults: &crate::manifest::DefaultsDef) -> IrDefaults {
    IrDefaults {
        max_retries: defaults.retry.max_retries,
        initial_delay_ms: defaults.retry.initial_delay_ms,
        webhook_tolerance_sec: defaults.webhook_tolerance_sec,
        limits_cache_ttl_ms: defaults.limits_cache_ttl_ms,
    }
}

fn all_error_kinds() -> Vec<IrErrorKind> {
    vec![
        IrErrorKind::Api,
        IrErrorKind::Paywall,
        IrErrorKind::Webhook,
        IrErrorKind::Transport,
    ]
}

fn validate_ruby_catalog(
    entries: &std::collections::BTreeMap<String, IrEntryPoint>,
) -> GenResult<()> {
    let mut names = BTreeSet::new();
    for entry in entries.values() {
        let key = (
            entry.ruby_target.owner.clone(),
            entry.ruby_target.name.clone(),
        );
        if !names.insert(key.clone()) {
            return Err(GenError::Parse(format!(
                "duplicate Ruby public name {}#{}",
                key.0, key.1
            )));
        }
        let mut saw_optional = false;
        for param in &entry.params {
            if param.required && saw_optional {
                return Err(GenError::Parse(format!(
                    "{}: required Ruby keyword {} appears after an optional keyword",
                    entry.id, param.names.rb
                )));
            }
            saw_optional |= !param.required;
        }
    }
    Ok(())
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
            binding_symbols: BTreeMap::new(),
        }
    }

    #[test]
    fn lowers_docs_summary_returns_and_param_merge() {
        let yaml = r#"
operations:
  checkLimits:
    names:
      ts: checkLimits
      py: check_limits
      rb: check_limits
      go: CheckLimits
      rust: check_limits
    response: LimitResponseWithPlan
    params:
      - name: params
        ref: CheckLimitsRequest
        required: true
        doc: "inline param doc — should lose to docs.params"
    docs:
      summary: "Check remaining usage/spend limits for a customer against a product's plan."
      params:
        params: "Limits request including customer and product refs."
      returns: "Current remaining limits, optionally including plan details."
    sync:
      ts: async
      py: [async, blocking]
      rb: blocking
      go: blocking
      rust: [async, blocking]
    errors:
      default:
        messageTemplate: "x"
"#;
        let manifest: Manifest = serde_norway::from_str(yaml).unwrap();
        let mut ir = empty_ir();
        lower_catalog(&mut ir, &manifest).unwrap();
        let ep = ir.entry_points.get("checkLimits").unwrap();
        assert_eq!(
            ep.docs.summary,
            "Check remaining usage/spend limits for a customer against a product's plan."
        );
        assert_eq!(
            ep.docs.returns.as_deref(),
            Some("Current remaining limits, optionally including plan details.")
        );
        assert_eq!(
            ep.params[0].doc,
            "Limits request including customer and product refs."
        );
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
      py: [async, blocking]
      rb: blocking
      go: blocking
      rust: [async, blocking]
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
      py: sync
      rb: sync
      go: sync
      rust: sync
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
        assert_eq!(ep.availability.rb, vec![IrSyncKind::Sync]);
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
                sync: serde_json::json!({
                    "ts": "async",
                    "py": ["async", "blocking"],
                    "rb": "blocking",
                    "go": "blocking",
                    "rust": ["async", "blocking"]
                }),
                errors: OperationErrors {
                    default: MessageTemplate {
                        message_template: "x".into(),
                    },
                    cases: vec![],
                },
                docs: DocsDef::default(),
            },
        );
        let manifest = Manifest {
            operations: ops,
            overlays: BTreeMap::new(),
            errors: None,
            top_level: BTreeMap::new(),
            core_helpers: BTreeMap::new(),
            facade: BTreeMap::new(),
            bindings: BTreeMap::new(),
            defaults: Default::default(),
        };
        lower_catalog(&mut ir, &manifest).unwrap();
        assert_eq!(
            ir.entry_points.get("checkLimits").unwrap().names.ts,
            "checkLimits"
        );
    }

    #[test]
    fn rejects_duplicate_ruby_public_names_within_an_owner() {
        let yaml = r#"
topLevel:
  first:
    names: { ts: first, py: first, rb: same_name, go: First, rust: first }
    sync: { ts: sync, py: sync, rb: sync, go: sync, rust: sync }
  second:
    names: { ts: second, py: second, rb: same_name, go: Second, rust: second }
    sync: { ts: sync, py: sync, rb: sync, go: sync, rust: sync }
"#;
        let manifest: Manifest = serde_norway::from_str(yaml).unwrap();
        let err = lower_catalog(&mut empty_ir(), &manifest).expect_err("duplicate Ruby name");
        assert!(err.to_string().contains("duplicate Ruby public name"));
    }

    #[test]
    fn rejects_missing_ruby_sync_availability() {
        let yaml = r#"
topLevel:
  helper:
    names: { ts: helper, py: helper, rb: helper, go: Helper, rust: helper }
    sync: { ts: sync, py: sync, go: sync, rust: sync }
"#;
        let manifest: Manifest = serde_norway::from_str(yaml).unwrap();
        let err = lower_catalog(&mut empty_ir(), &manifest).expect_err("missing Ruby sync");
        assert!(err.to_string().contains("missing Ruby sync"));
    }

    #[test]
    fn rejects_required_ruby_keyword_after_optional_keyword() {
        let yaml = r#"
topLevel:
  helper:
    names: { ts: helper, py: helper, rb: helper, go: Helper, rust: helper }
    params:
      - { name: optionalValue, type: string, required: false }
      - { name: requiredValue, type: string, required: true }
    sync: { ts: sync, py: sync, rb: sync, go: sync, rust: sync }
"#;
        let manifest: Manifest = serde_norway::from_str(yaml).unwrap();
        let err = lower_catalog(&mut empty_ir(), &manifest).expect_err("keyword ordering");
        assert!(err.to_string().contains("required Ruby keyword"));
    }
}
