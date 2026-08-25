//! Integration golden: scanned `pub fn` signatures join to binding symbols.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::fs;

use dto_gen::ir::{Ir, IrCoreFieldTy};
use dto_gen::lower_core_types::dump_core_types;

fn fn_at<'a>(ir: &'a Ir, path: &str) -> &'a dto_gen::ir::IrCoreFn {
    ir.core_fns
        .get(path)
        .unwrap_or_else(|| panic!("missing fn {path}"))
}

#[test]
fn classify_customer_ref_signature() {
    let ir = support::lower_bindings_ir();
    let func = fn_at(&ir, "solvapay_core::customer_sync::classify_customer_ref");
    assert_eq!(func.params.len(), 1);
    assert!(func.params[0].by_ref);
    assert!(!func.params[0].ty.optional);
    assert_eq!(func.params[0].ty.ty, IrCoreFieldTy::String);
    assert!(!func.return_ty.optional);
    assert_eq!(
        func.return_ty.ty,
        IrCoreFieldTy::Named("CustomerRefKind".into())
    );
}

#[test]
fn validate_activate_plan_params_returns_option_helper_error() {
    let ir = support::lower_bindings_ir();
    let func = fn_at(
        &ir,
        "solvapay_core::activation::validate_activate_plan_params",
    );
    assert!(func.return_ty.optional);
    assert_eq!(
        func.return_ty.ty,
        IrCoreFieldTy::Named("HelperErrorResult".into())
    );
}

#[test]
fn select_active_purchases_slice_of_value() {
    let ir = support::lower_bindings_ir();
    let func = fn_at(&ir, "solvapay_core::purchase::select_active_purchases");
    assert_eq!(func.params.len(), 1);
    assert!(func.params[0].by_ref);
    assert_eq!(
        func.params[0].ty.ty,
        IrCoreFieldTy::Vec(Box::new(IrCoreFieldTy::Value))
    );
    assert_eq!(
        func.return_ty.ty,
        IrCoreFieldTy::Vec(Box::new(IrCoreFieldTy::Value))
    );
}

#[test]
fn dump_matches_two_walks() {
    let a = support::lower_bindings_ir();
    let b = support::lower_bindings_ir();
    assert_eq!(a.core_fns, b.core_fns);
    let first = dump_core_types(&a).unwrap();
    let second = dump_core_types(&b).unwrap();
    assert_eq!(first, second);
    assert!(first.contains("\"fns\""));
}

#[test]
fn every_sync_core_binding_resolves() {
    let ir = support::lower_bindings_ir();
    assert!(!ir.core_fns.is_empty(), "expected scanned core functions");
}
