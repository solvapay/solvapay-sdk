//! Rendered-output YARD coverage for the Ruby public facade (D19 / Step 45T).

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::fs;
use std::path::{Path, PathBuf};

use dto_gen::ir::{Ir, IrErrorTemplates, IrRubyReceiver};
use dto_gen::{check_doc_coverage, emit_client_rb, lower_bindings, lower_catalog, Manifest};

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3)
        .expect("repo root")
        .to_path_buf()
}

fn ir() -> Ir {
    let raw =
        fs::read_to_string(root().join("contract/manifest/sdk-contract.yaml")).expect("manifest");
    let manifest: Manifest = serde_norway::from_str(&raw).expect("parse manifest");
    let mut ir = Ir {
        types: Default::default(),
        overlay_helpers: Default::default(),
        overlays: Default::default(),
        routes: vec![],
        error_templates: IrErrorTemplates::default(),
        entry_points: Default::default(),
        binding_symbols: Default::default(),
    };
    lower_catalog(&mut ir, &manifest).expect("lower catalog");
    check_doc_coverage(&ir).expect("IR doc coverage");
    lower_bindings(&mut ir, &manifest).expect("lower bindings");
    ir
}

/// Returns true when `needle` appears in `source` immediately preceded by a
/// non-empty `# …` summary line (YARD).
fn has_yard_above(source: &str, def_line: &str) -> bool {
    let Some(index) = source.find(def_line) else {
        return false;
    };
    let before = &source[..index];
    let Some(last_line) = before.lines().rev().find(|line| !line.trim().is_empty()) else {
        return false;
    };
    let trimmed = last_line.trim_start();
    trimmed.starts_with('#') && trimmed.len() > 1
}

#[test]
fn every_catalogued_client_and_helper_def_has_yard_summary() {
    let ir = ir();
    let emitted = emit_client_rb(&ir).expect("emit Ruby public");

    for entry in ir.entry_points.values() {
        if entry.availability.rb.is_empty() {
            continue;
        }
        match entry.ruby_target.receiver {
            IrRubyReceiver::ClientInstance => {
                let def_line = format!("    def {}", entry.ruby_target.name);
                assert!(
                    emitted.client_rb.contains(&def_line),
                    "missing client def for {}",
                    entry.ruby_target.name
                );
                assert!(
                    has_yard_above(&emitted.client_rb, &def_line),
                    "missing YARD above client def {}",
                    entry.ruby_target.name
                );
            }
            IrRubyReceiver::ModuleFunction => {
                // Hand-written helpers (verify_webhook / with_retry) live outside
                // helpers.generated.rb; catalog constants emit `NAME = …`, not defs.
                if matches!(
                    entry.ruby_target.name.as_str(),
                    "verify_webhook" | "with_retry" | "create"
                ) {
                    continue;
                }
                let def_line = format!("  def self.{}", entry.ruby_target.name);
                if !emitted.helpers_rb.contains(&def_line) {
                    continue;
                }
                assert!(
                    has_yard_above(&emitted.helpers_rb, &def_line),
                    "missing YARD above helper def {}",
                    entry.ruby_target.name
                );
            }
            IrRubyReceiver::FacadeInstance
            | IrRubyReceiver::ErrorClass
            | IrRubyReceiver::Constant => {}
        }
    }
}
