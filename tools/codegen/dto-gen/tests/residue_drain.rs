//! Residue keys must change the derived symbol. Restated args/docs are an error.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::fs;

use dto_gen::error::GenResult;
use dto_gen::ir::Ir;
use dto_gen::lower_catalog::lower_catalog;
use dto_gen::lower_core_types::{lower_core_types, lower_transport_fns};
use dto_gen::lower_errors::lower_errors;
use dto_gen::lower_overlays::lower_overlays;
use dto_gen::manifest::Manifest;
use dto_gen::parse::parse_openapi;
use dto_gen::{load_binding_residue, redundant_residue_keys};

fn scanned_ir() -> (Ir, dto_gen::manifest::BindingResidueManifest) {
    let paths = repo_paths::load().expect("repo-paths");
    let snapshot = paths.contract_input("openapiSnapshot").expect("snapshot");
    let raw = fs::read_to_string(&snapshot).expect("read snapshot");
    let value = serde_json::from_str(&raw).expect("json");
    let mut ir = parse_openapi(&value).expect("openapi");
    let manifest_path = paths.contract_input("sdkManifest").expect("manifest");
    let manifest_raw = fs::read_to_string(&manifest_path).expect("read manifest");
    let manifest: Manifest = serde_norway::from_str(&manifest_raw).expect("manifest");
    lower_overlays(&mut ir, &manifest).expect("overlays");
    lower_errors(&mut ir, &manifest).expect("errors");
    lower_catalog(&mut ir, &manifest).expect("catalog");
    let core_src = paths.contract_input("coreSrc").expect("coreSrc");
    lower_core_types(&mut ir, &core_src, &manifest).expect("core types");
    let transport_src = paths.contract_input("transportSrc").expect("transportSrc");
    lower_transport_fns(&mut ir, &transport_src).expect("transport");
    let residue_path = paths.contract_input("bindingResidue").expect("residue");
    let residue = load_binding_residue(&residue_path).expect("load residue");
    (ir, residue)
}

#[test]
fn residue_has_no_redundant_keys() -> GenResult<()> {
    let (ir, residue) = scanned_ir();
    let redundant = redundant_residue_keys(&ir, &residue)?;
    assert!(
        redundant.is_empty(),
        "binding-residue.yaml keys that do not change the derived symbol (delete them): {redundant:?}"
    );
    Ok(())
}

#[test]
fn scratch_core_helper_needs_no_residue() {
    let (mut ir, residue) = scanned_ir();
    let mut probe = ir
        .core_fns
        .values()
        .find(|func| func.name == "classify_customer_ref")
        .expect("classify_customer_ref export")
        .clone();
    probe.name = "touch_set_probe".into();
    ir.core_fns.insert(probe.core_path(), probe);
    dto_gen::install_derived_bindings(&mut ir, &residue).expect("derive");
    let symbol = ir
        .binding_symbols
        .get("touchSetProbe")
        .expect("scratch export must bind without a residue key");
    assert!(symbol.verbatim_body.is_none());
    assert!(symbol.ts_wrapper.is_none());
    assert_eq!(symbol.args.len(), 1);
    assert!(!residue.contains_key("touchSetProbe"));
}
