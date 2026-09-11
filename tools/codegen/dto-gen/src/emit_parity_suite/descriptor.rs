//! Language-neutral IR pass for signature-parity suite emitters.

use crate::emit_client_go::{go_params, serialize_kind, GoParam};
use crate::emit_client_rs::{client_operations, rust_ok_type, rust_params, RustParam};
use crate::error::GenResult;
use crate::ir::{
    Ir, IrBindingArtifact, IrBindingCatalogLink, IrDefaults, IrEntrySection, IrLangNames,
    IrRubyReceiver, IrRubyTarget, IrSyncKind,
};

/// Catalog + binding facts shared by every language-specific parity renderer.
#[derive(Debug, Clone)]
pub(super) struct ParitySuiteDescriptor {
    /// Defaults from the first catalog entry point (TS / Python / Ruby).
    pub(super) catalog_defaults: IrDefaults,
    /// Catalog operations in `BTreeMap` id order.
    pub(super) operations: Vec<ParityOperation>,
    /// Client-instance Ruby targets in catalog id order (renderer sorts).
    pub(super) ruby_client_ops: Vec<ParityOperation>,
    /// Module-function helper names from catalogued bindings, sorted unique.
    pub(super) ruby_helpers: Vec<String>,
    /// Client-bound operations sorted by Rust name (`client_operations`).
    pub(super) client_ops: Vec<ParityClientOp>,
    /// Client binding symbols sorted by `emit_order` then id (C).
    pub(super) client_bindings: Vec<ParityBinding>,
}

/// One catalogued client operation (section `Operation`).
#[derive(Debug, Clone)]
pub(super) struct ParityOperation {
    /// Per-language public names.
    pub(super) names: IrLangNames,
    /// Ruby owner / method / receiver.
    pub(super) ruby_target: IrRubyTarget,
    /// TypeScript sync kind.
    pub(super) sync_ts: IrSyncKind,
    /// Catalog parameters.
    pub(super) params: Vec<ParityParam>,
}

/// One catalog parameter with per-language names.
#[derive(Debug, Clone)]
pub(super) struct ParityParam {
    /// Per-language public parameter names.
    pub(super) names: IrLangNames,
    /// Required vs optional.
    pub(super) required: bool,
}

/// Client-bound operation with Go/Rust facade params resolved.
#[derive(Debug, Clone)]
pub(super) struct ParityClientOp {
    /// Frozen defaults on this entry (Go/Rust take the first of their sort).
    pub(super) defaults: IrDefaults,
    /// Per-language public names.
    pub(super) names: IrLangNames,
    /// Catalog parameters (Rust `OPERATION_SIGNATURES` table).
    pub(super) params: Vec<ParityParam>,
    /// Go facade parameter names and source types.
    pub(super) go_params: Vec<GoParam>,
    /// Rust facade parameters (typed sink).
    pub(super) rust_params: Vec<RustParam>,
    /// Rust `Result` ok-type.
    pub(super) rust_ok_type: String,
}

/// Client binding used by the C ABI probe table.
#[derive(Debug, Clone)]
pub(super) struct ParityBinding {
    /// Canonical catalog / dispatch id.
    pub(super) id: String,
    /// Required split-path JSON keys in probe order.
    pub(super) split_path_refs: Vec<String>,
}

impl ParitySuiteDescriptor {
    /// Lowers catalog + binding IR into one language-neutral descriptor.
    ///
    /// # Errors
    ///
    /// Returns [`crate::error::GenError`] when a client binding has an unexpected
    /// serialize kind or an unsupported Go/Rust parameter type.
    pub(super) fn from_ir(ir: &Ir) -> GenResult<Self> {
        let catalog_defaults = ir
            .entry_points
            .values()
            .next()
            .map(|entry| entry.defaults.clone())
            .unwrap_or_default();

        let operations = ir
            .entry_points
            .values()
            .filter(|entry| entry.section == IrEntrySection::Operation)
            .map(parity_operation)
            .collect();

        let ruby_client_ops = ir
            .entry_points
            .values()
            .filter(|entry| entry.ruby_target.receiver == IrRubyReceiver::ClientInstance)
            .map(parity_operation)
            .collect();

        let mut ruby_helpers = Vec::new();
        for binding in ir.binding_symbols.values() {
            let id = match &binding.catalog {
                IrBindingCatalogLink::TopLevel(id) | IrBindingCatalogLink::CoreHelper(id) => id,
                _ => continue,
            };
            if matches!(
                id.as_str(),
                "verifyWebhook" | "withRetry" | "SolvaPayError" | "PaywallError"
            ) {
                continue;
            }
            if let Some(entry) = ir.entry_points.get(id) {
                if entry.ruby_target.receiver == IrRubyReceiver::ModuleFunction {
                    ruby_helpers.push(entry.ruby_target.name.clone());
                }
            }
        }
        ruby_helpers.sort();
        ruby_helpers.dedup();

        let mut client_ops = Vec::new();
        for (entry, binding) in client_operations(ir) {
            let kind = serialize_kind(binding)?;
            client_ops.push(ParityClientOp {
                defaults: entry.defaults.clone(),
                names: entry.names.clone(),
                params: entry.params.iter().map(parity_param).collect(),
                go_params: go_params(entry, kind)?,
                rust_params: rust_params(entry, binding)?,
                rust_ok_type: rust_ok_type(entry),
            });
        }

        let mut client_bindings: Vec<_> = ir
            .binding_symbols
            .values()
            .filter(|sym| matches!(sym.artifact, IrBindingArtifact::Client))
            .collect();
        client_bindings.sort_by(|a, b| a.emit_order.cmp(&b.emit_order).then(a.id.cmp(&b.id)));
        let client_bindings = client_bindings
            .into_iter()
            .map(|sym| ParityBinding {
                id: sym.id.clone(),
                split_path_refs: sym.split_path_refs.clone(),
            })
            .collect();

        Ok(Self {
            catalog_defaults,
            operations,
            ruby_client_ops,
            ruby_helpers,
            client_ops,
            client_bindings,
        })
    }
}

fn parity_operation(entry: &crate::ir::IrEntryPoint) -> ParityOperation {
    ParityOperation {
        names: entry.names.clone(),
        ruby_target: entry.ruby_target.clone(),
        sync_ts: entry.sync_ts,
        params: entry.params.iter().map(parity_param).collect(),
    }
}

fn parity_param(param: &crate::ir::IrParam) -> ParityParam {
    ParityParam {
        names: param.names.clone(),
        required: param.required,
    }
}
