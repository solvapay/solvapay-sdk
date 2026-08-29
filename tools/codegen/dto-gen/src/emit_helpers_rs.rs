//! Emit `helpers_generated.rs` as doc-carrying `pub use` re-exports.

use std::collections::BTreeSet;
use std::fmt::Write as _;

use crate::emit_client_rs::render_rustdoc;
use crate::emit_helpers::{catalog_helper_bindings, is_constant_entry};
use crate::error::{GenError, GenResult};
use crate::header::{generated_header, CommentStyle};
use crate::ir::{Ir, IrCoreFieldTy, IrCoreFn, IrCoreParamTy};

/// Emits `sdks/rust/src/helpers_generated.rs`.
///
/// # Errors
///
/// Returns [`GenError::Parse`] when a helper's core path is missing or a
/// signature type is not re-exported at the `solvapay_core` root.
pub fn emit_helpers_rs(ir: &Ir) -> GenResult<String> {
    let mut out = format!(
        "{}\n",
        generated_header(CommentStyle::LineSlash, "rs-helpers-out")
    );
    out.push_str("//! Generated portable helper re-exports.\n\n");

    let mut type_names: BTreeSet<String> = BTreeSet::new();
    let mut items = String::new();
    for (binding, entry) in catalog_helper_bindings(ir) {
        if !entry.emission.rust.is_generated() {
            continue;
        }
        if is_constant_entry(entry) {
            collect_named_types(ir, binding.core.as_str(), &mut type_names)?;
        } else {
            collect_named_types(ir, binding.core.as_str(), &mut type_names)?;
        }
        for line in render_rustdoc(entry) {
            if line.is_empty() {
                items.push_str("///\n");
            } else {
                let _ = writeln!(items, "/// {line}");
            }
        }
        let last_segment = binding.core.rsplit("::").next();
        if last_segment != Some(entry.names.rust.as_str()) {
            let _ = writeln!(items, "pub use {} as {};\n", binding.core, entry.names.rust);
        } else {
            let _ = writeln!(items, "pub use {};\n", binding.core);
        }
    }

    if !type_names.is_empty() {
        let mut missing = Vec::new();
        for name in &type_names {
            if !ir.core_types.contains_key(name) {
                missing.push(name.clone());
                continue;
            }
            // Core types live in submodules; they must be `pub use`d at the crate root
            // so `pub use solvapay_core::{Name}` is nameable for integrators.
            if !core_root_reexport_names().contains(name.as_str()) {
                return Err(GenError::Parse(format!(
                    "helper signature type {name} is not re-exported at solvapay_core root; add `pub use …::{name}` to core/solvapay-core/src/lib.rs"
                )));
            }
        }
        if !missing.is_empty() {
            return Err(GenError::Parse(format!(
                "helper signature types missing from scanned core types: {}",
                missing.join(", ")
            )));
        }
        out.push_str("pub use solvapay_core::{");
        let mut first = true;
        for name in &type_names {
            if !first {
                out.push_str(", ");
            }
            first = false;
            out.push_str(name);
        }
        out.push_str("};\n\n");
    }
    out.push_str(&items);
    Ok(out)
}

fn collect_named_types(ir: &Ir, core_path: &str, out: &mut BTreeSet<String>) -> GenResult<()> {
    let func = ir
        .core_fns
        .get(core_path)
        .or_else(|| ir.core_fns.values().find(|f| f.core_path() == core_path));
    let Some(func) = func else {
        return Err(GenError::Parse(format!(
            "no scanned core fn for helper path {core_path}"
        )));
    };
    push_named(&func.return_ty, out);
    for param in &func.params {
        push_named(&param.ty, out);
    }
    let _ = func as &IrCoreFn;
    Ok(())
}

fn push_named(ty: &IrCoreParamTy, out: &mut BTreeSet<String>) {
    if let IrCoreFieldTy::Named(name) = &ty.ty {
        if name.chars().next().is_some_and(|c| c.is_ascii_uppercase()) {
            out.insert(name.clone());
        }
    }
}

fn core_root_reexport_names() -> BTreeSet<&'static str> {
    // Keep in sync with `core/solvapay-core/src/lib.rs` `pub use` identifiers.
    // The emitter fails loudly when a helper signature needs a name not listed here.
    [
        "TaxIdType",
        "BusinessDetails",
        "BusinessDetailsInput",
        "BusinessDetailsValidationError",
        "BusinessDetailsValidationIssue",
        "BusinessCountryOption",
        "ValidateBusinessDetailsResult",
        "SellerIdentityDisplay",
        "SellerIdentityInput",
        "SellerIdentityRow",
        "CreditsToDisplayInput",
        "ProductReadinessInput",
        "ProductReadinessPlan",
        "ProductReadinessResult",
        "PaywallGate",
        "PaywallGateKind",
        "PaywallGateLimits",
        "PaywallClientPayload",
        "PaywallState",
        "PaywallLimits",
        "PaywallPlanSummary",
        "PaywallBalance",
        "GateContent",
        "Charge",
        "ChargePer",
        "BillingCycle",
        "BillingInterval",
        "CachedLimitsEvaluation",
        "FreshLimitsEvaluation",
        "PaywallOutcome",
    ]
    .into_iter()
    .collect()
}
