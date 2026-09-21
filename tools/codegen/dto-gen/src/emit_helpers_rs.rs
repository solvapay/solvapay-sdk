//! Emit `helpers_generated.rs` as doc-carrying `pub use` re-exports.

use std::collections::BTreeSet;
use std::fmt::Write as _;

use crate::emit_client_rs::render_rustdoc;
use crate::emit_helpers::catalog_helper_bindings;
use crate::error::{GenError, GenResult};
use crate::header::{generated_header, CommentStyle};
use crate::ir::{
    Ir, IrBindingCatalogLink, IrBindingSymbol, IrCoreFieldTy, IrCoreFn, IrCoreParamTy,
};

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
        collect_named_types(ir, binding.core.as_str(), &mut type_names)?;
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
        out.push_str("#[allow(unused_imports)]\n");
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
    out.push_str(&emit_unscoped_bindings(ir)?);
    Ok(out)
}

/// Binding symbols with `catalog: none` are real core functions the other
/// facades call by name. Re-export them so the Rust crate is not a subset.
/// Driver steppers stay in a hidden module; they are host-loop internals.
fn emit_unscoped_bindings(ir: &Ir) -> GenResult<String> {
    let mut public = String::new();
    let mut internal = String::new();
    let mut symbols: Vec<&IrBindingSymbol> = ir
        .binding_symbols
        .values()
        .filter(|binding| matches!(binding.catalog, IrBindingCatalogLink::None))
        .collect();
    symbols.sort_by(|left, right| left.id.cmp(&right.id));
    for binding in symbols {
        if is_driver_stepper(binding) {
            push_reexport(&mut internal, binding)?;
            continue;
        }
        if is_inherent_method(&binding.core) {
            push_method_forwarder(&mut public, binding)?;
            continue;
        }
        push_reexport(&mut public, binding)?;
    }
    let mut out = String::new();
    if !public.is_empty() {
        out.push_str("\n// Internal cores (`catalog: none`) re-exported for facade parity.\n\n");
        out.push_str(&public);
    }
    if !internal.is_empty() {
        out.push_str(
            "\n/// Driver steppers. Host loops call these; they are not integrator API.\n",
        );
        out.push_str("#[doc(hidden)]\n");
        out.push_str("pub mod internal {\n");
        for line in internal.lines() {
            if line.is_empty() {
                out.push('\n');
            } else {
                out.push_str("    ");
                out.push_str(line);
                out.push('\n');
            }
        }
        out.push_str("}\n");
    }
    Ok(out)
}

fn is_driver_stepper(binding: &IrBindingSymbol) -> bool {
    binding.names.rust.ends_with("_next")
}

fn is_inherent_method(core: &str) -> bool {
    core.split("::")
        .skip(1)
        .any(|segment| segment.starts_with(|c: char| c.is_ascii_uppercase()))
}

fn push_reexport(out: &mut String, binding: &IrBindingSymbol) -> GenResult<()> {
    push_binding_doc(out, binding);
    let rust_name = binding.names.rust.as_str();
    let last = binding.core.rsplit("::").next().unwrap_or(rust_name);
    if last == rust_name {
        let _ = writeln!(out, "pub use {};\n", binding.core);
    } else {
        let _ = writeln!(out, "pub use {} as {rust_name};\n", binding.core);
    }
    Ok(())
}

fn push_method_forwarder(out: &mut String, binding: &IrBindingSymbol) -> GenResult<()> {
    if binding.id != "retryNextDelayMs" {
        return Err(GenError::Parse(format!(
            "catalog-none binding {} is an inherent method ({}); add an explicit Rust forwarder",
            binding.id, binding.core
        )));
    }
    push_binding_doc(out, binding);
    out.push_str(
        "#[inline]\n\
         pub fn retry_next_delay_ms(\n\
         \x20   policy: &solvapay_core::RetryPolicy,\n\
         \x20   attempt: u32,\n\
         ) -> Option<std::time::Duration> {\n\
         \x20   policy.next_delay(attempt)\n\
         }\n\n",
    );
    Ok(())
}

fn push_binding_doc(out: &mut String, binding: &IrBindingSymbol) {
    let doc = binding.doc.trim();
    if doc.is_empty() {
        let _ = writeln!(out, "/// `{}`.", binding.id);
        return;
    }
    for line in doc.lines() {
        let _ = writeln!(out, "/// {line}");
    }
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
        "PaywallNextAction",
        "CreditSignals",
        "PaywallLimits",
        "PaywallPlanSummary",
        "PaywallBalance",
        "GateContent",
        "Charge",
        "ChargePer",
        "BillingCycle",
        "BillingInterval",
        "Tier",
        "TierMode",
        "UsageRate",
        "PlanPricingShape",
        "PricingShape",
        "CachedLimitsEvaluation",
        "FreshLimitsEvaluation",
        "PaywallOutcome",
        "CustomerSnapshot",
        "AllowConsequence",
        "FreeLimit",
        "FreeLimitInput",
        "FreeLimitScope",
        "UsageExtra",
        "UsageClass",
    ]
    .into_iter()
    .collect()
}
