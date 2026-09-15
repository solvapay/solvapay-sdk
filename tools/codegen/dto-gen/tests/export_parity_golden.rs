//! Derived `#[solvapay_export]` symbols vs the committed binding-symbols snapshot.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::fs;

use dto_gen::derive_bindings::derive_all_export_bindings;
use dto_gen::ir::{Ir, IrErrorTemplates};
use dto_gen::lower_bindings::dump_binding_symbols;
use dto_gen::lower_core_types::{lower_core_types, lower_transport_fns};
use dto_gen::manifest::{BindingResidueManifest, Manifest};
use serde_json::Value;

#[test]
fn yaml_bindings_section_is_absent() {
    let manifest_path = paths().contract_input("sdkManifest").expect("sdkManifest");
    let raw = fs::read_to_string(&manifest_path).expect("read manifest");
    assert!(
        !raw.lines().any(|line| line == "bindings:"),
        "sdk-contract.yaml still has a bindings: section"
    );
    assert!(
        !raw.lines().any(|line| line == "boundaryTypes:"),
        "sdk-contract.yaml still has a boundaryTypes: list"
    );
}

#[test]
fn derived_core_symbols_match_snapshot() {
    let ir = yaml_ir();
    let residue = load_residue();
    let scan_symbols = derive_all_export_bindings(&ir, &residue).expect("derive");
    let derived_ir = Ir {
        binding_symbols: scan_symbols
            .into_iter()
            .filter(|(_, symbol)| symbol.core.starts_with("solvapay_core::"))
            .collect(),
        ..Ir::default()
    };
    let derived_doc: Value =
        serde_json::from_str(&dump_binding_symbols(&derived_ir)).expect("derived json");
    let snapshot: Value = serde_json::from_str(
        &fs::read_to_string(paths().generated_path("bindingSymbols").expect("snapshot"))
            .expect("read snapshot"),
    )
    .expect("parse snapshot");
    let derived_map = derived_doc
        .get("bindings")
        .and_then(Value::as_object)
        .expect("derived bindings");
    let snapshot_map = snapshot
        .get("bindings")
        .and_then(Value::as_object)
        .expect("snapshot bindings");
    let snapshot_core: Vec<&String> = snapshot_map
        .iter()
        .filter(|(_, v)| {
            v.get("core")
                .and_then(Value::as_str)
                .is_some_and(|c| c.starts_with("solvapay_core::"))
        })
        .map(|(id, _)| id)
        .collect();
    for id in &snapshot_core {
        assert_eq!(derived_map.get(*id), snapshot_map.get(*id), "symbol {id}");
    }
    assert_eq!(
        snapshot_core.len(),
        derived_map.len(),
        "no undeclared derived symbols: extra {:?}",
        derived_map
            .keys()
            .filter(|id| !snapshot_core.iter().any(|s| s == id))
            .collect::<Vec<_>>()
    );
}

#[test]
fn transport_fns_are_indexed_separately_from_core_fns() {
    let ir = yaml_ir();
    assert!(
        ir.core_fns.keys().all(|k| k.starts_with("solvapay_core::")),
        "core_fns leaked a non-core path: {:?}",
        ir.core_fns
            .keys()
            .filter(|k| !k.starts_with("solvapay_core::"))
            .collect::<Vec<_>>()
    );
    assert!(
        ir.transport_fns
            .keys()
            .all(|k| k.starts_with("solvapay_transport::")),
        "transport_fns leaked a non-transport path"
    );
    let activate = ir
        .transport_fns
        .values()
        .find(|func| {
            func.name == "activate_plan" && func.impl_ty.as_deref() == Some("SolvaPayClient")
        })
        .expect("SolvaPayClient::activate_plan scanned");
    assert!(activate.is_async);
    assert_eq!(
        activate.binding_core(),
        "solvapay_transport::SolvaPayClient::activate_plan"
    );
    assert!(!ir.core_fns.contains_key(&activate.core_path()));
}

#[test]
fn derived_client_symbols_match_snapshot() {
    let ir = yaml_ir();
    let residue = load_residue();
    let derived = derive_all_export_bindings(&ir, &residue).expect("derive");
    let derived_ir = Ir {
        binding_symbols: derived
            .into_iter()
            .filter(|(_, symbol)| symbol.core.starts_with("solvapay_transport::"))
            .collect(),
        ..Ir::default()
    };
    let derived_doc: Value =
        serde_json::from_str(&dump_binding_symbols(&derived_ir)).expect("derived json");
    let snapshot: Value = serde_json::from_str(
        &fs::read_to_string(paths().generated_path("bindingSymbols").expect("snapshot"))
            .expect("read snapshot"),
    )
    .expect("parse snapshot");
    let derived_map = derived_doc
        .get("bindings")
        .and_then(Value::as_object)
        .expect("derived bindings");
    let snapshot_map = snapshot
        .get("bindings")
        .and_then(Value::as_object)
        .expect("snapshot bindings");
    let snapshot_client: Vec<&String> = snapshot_map
        .iter()
        .filter(|(_, v)| {
            v.get("core")
                .and_then(Value::as_str)
                .is_some_and(|c| c.starts_with("solvapay_transport::"))
        })
        .map(|(id, _)| id)
        .collect();
    for id in &snapshot_client {
        assert_eq!(derived_map.get(*id), snapshot_map.get(*id), "symbol {id}");
    }
    assert_eq!(
        snapshot_client.len(),
        derived_map.len(),
        "no undeclared derived client symbols: extra {:?}",
        derived_map
            .keys()
            .filter(|id| !snapshot_client.iter().any(|s| s == id))
            .collect::<Vec<_>>()
    );
}

fn paths() -> repo_paths::RepoPaths {
    repo_paths::load().expect("repo-paths")
}

fn yaml_ir() -> Ir {
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
    let core_src = paths().contract_input("coreSrc").expect("coreSrc");
    lower_core_types(&mut ir, &core_src, &manifest).expect("lower core types");
    let transport_src = paths()
        .contract_input("transportSrc")
        .expect("transportSrc");
    lower_transport_fns(&mut ir, &transport_src).expect("lower transport");
    ir
}

fn load_residue() -> BindingResidueManifest {
    let path = paths()
        .contract_input("bindingResidue")
        .expect("bindingResidue");
    let raw = fs::read_to_string(&path).expect("read residue");
    serde_norway::from_str(&raw).expect("parse residue")
}
