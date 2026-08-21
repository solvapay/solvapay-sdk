//! Integration golden: scanned `pub fn` signatures join to binding symbols.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::fs;

use dto_gen::ir::{Ir, IrCoreFieldTy, IrErrorTemplates};
use dto_gen::lower_core_types::dump_core_types;
use dto_gen::manifest::Manifest;

fn paths() -> repo_paths::RepoPaths {
    repo_paths::load().expect("repo-paths")
}

fn lower_ir() -> Ir {
    let manifest_path = paths().contract_input("sdkManifest").expect("sdkManifest");
    let raw = fs::read_to_string(&manifest_path).expect("read manifest");
    let manifest: Manifest = serde_norway::from_str(&raw).expect("parse manifest");
    let mut ir = Ir {
        types: Default::default(),
        overlay_helpers: Default::default(),
        overlays: Default::default(),
        routes: vec![],
        error_templates: IrErrorTemplates::default(),
        entry_points: Default::default(),
        binding_symbols: Default::default(),
        core_types: Default::default(),
        core_types_ts: Default::default(),
        core_fns: Default::default(),
        transport_fns: Default::default(),
    };
    let residue = dto_gen::load_binding_residue(
        &paths()
            .contract_input("bindingResidue")
            .expect("bindingResidue"),
    )
    .expect("residue");
    dto_gen::lower_all_bindings(
        &mut ir,
        &manifest,
        &paths().contract_input("coreSrc").expect("coreSrc"),
        &residue,
        Some(
            &paths()
                .contract_input("transportSrc")
                .expect("transportSrc"),
        ),
    )
    .expect("lower bindings");
    ir
}

fn fn_at<'a>(ir: &'a Ir, path: &str) -> &'a dto_gen::ir::IrCoreFn {
    ir.core_fns
        .get(path)
        .unwrap_or_else(|| panic!("missing fn {path}"))
}

#[test]
fn classify_customer_ref_signature() {
    let ir = lower_ir();
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
    let ir = lower_ir();
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
    let ir = lower_ir();
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
    let a = lower_ir();
    let b = lower_ir();
    assert_eq!(a.core_fns, b.core_fns);
    let first = dump_core_types(&a).unwrap();
    let second = dump_core_types(&b).unwrap();
    assert_eq!(first, second);
    assert!(first.contains("\"fns\""));
}

#[test]
fn every_sync_core_binding_resolves() {
    let ir = lower_ir();
    assert!(!ir.core_fns.is_empty(), "expected scanned core functions");
}
