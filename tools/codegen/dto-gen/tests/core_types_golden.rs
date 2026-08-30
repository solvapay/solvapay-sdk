//! Integration golden: scan the real `solvapay-core` crate and ratchet TS mirrors.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::collections::{BTreeMap, BTreeSet};
use std::fs;

use dto_gen::ir::{IrCoreSerde, IrCoreShape, IrCoreType};
use dto_gen::lower_core_types::{
    close_core_types, export_type_roots, index_core_fns, index_core_types, walk_core_src,
};
use dto_gen::manifest::Manifest;

/// Locked closure size. Bump only when a root or nested named type is added/removed.
const RESOLVED_COUNT: usize = 80;

fn lowered() -> BTreeMap<String, IrCoreType> {
    let core_src = paths().contract_input("coreSrc").expect("coreSrc");
    let scanned = walk_core_src(&core_src).expect("walk core");
    let index = index_core_types(scanned.types).expect("index");
    let fns = index_core_fns(scanned.fns).expect("fns");
    let roots = export_type_roots(&fns, &index);
    close_core_types(&index, &roots).expect("close")
}

#[test]
fn closure_resolves_every_export_root_at_locked_count() {
    let closed = lowered();
    let core_src = paths().contract_input("coreSrc").expect("coreSrc");
    let scanned = walk_core_src(&core_src).expect("walk core");
    let index = index_core_types(scanned.types).expect("index");
    let fns = index_core_fns(scanned.fns).expect("fns");
    let roots = export_type_roots(&fns, &index);
    assert!(!roots.is_empty(), "expected named types on exported fns");
    for root in &roots {
        assert!(
            closed.contains_key(root),
            "root {root} missing from closure"
        );
    }
    assert_eq!(
        closed.len(),
        RESOLVED_COUNT,
        "closure size changed: got {} expected {RESOLVED_COUNT} keys {:?}",
        closed.len(),
        closed.keys().collect::<Vec<_>>()
    );
}

/// Overlay-owned residue (rename / reshape). Empty means every remaining
/// serde type must match the TS extractor.
fn overlay_skip_rust_names() -> BTreeSet<String> {
    let manifest_path = paths().contract_input("sdkManifest").expect("sdkManifest");
    let raw = fs::read_to_string(&manifest_path).expect("read manifest");
    let manifest: Manifest = serde_norway::from_str(&raw).expect("parse manifest");
    let mut skip = BTreeSet::new();
    skip.extend(manifest.boundary_types_ts.rename.keys().cloned());
    skip.extend(manifest.boundary_types_ts.reshape.keys().cloned());
    skip
}

fn paths() -> repo_paths::RepoPaths {
    repo_paths::load().expect("repo-paths")
}

#[test]
fn dump_matches_two_walks() {
    let a = lowered();
    let b = lowered();
    assert_eq!(a, b);
}

enum TsShape {
    Object { keys: BTreeSet<String> },
    StringUnion { values: BTreeSet<String> },
    Union,
}

fn parse_ts_types(dir: &std::path::Path) -> BTreeMap<String, TsShape> {
    let mut out = BTreeMap::new();
    collect_ts_types(dir, &mut out);
    out
}

fn collect_ts_types(dir: &std::path::Path, out: &mut BTreeMap<String, TsShape>) {
    for entry in fs::read_dir(dir).expect("core ts dir") {
        let entry = entry.expect("dirent");
        let path = entry.path();
        if path.is_dir() {
            collect_ts_types(&path, out);
            continue;
        }
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        let is_ts = name.ends_with(".ts") || name.ends_with(".d.ts");
        if !is_ts || name.ends_with(".test.ts") {
            continue;
        }
        let src = fs::read_to_string(&path).expect("read ts");
        extract_types(&src, out);
    }
}

fn extract_types(src: &str, out: &mut BTreeMap<String, TsShape>) {
    let mut rest = src;
    while let Some(idx) = rest.find("export type ") {
        rest = &rest[idx + "export type ".len()..];
        let name_end = rest
            .find(|c: char| !c.is_ascii_alphanumeric() && c != '_')
            .unwrap_or(rest.len());
        let name = rest[..name_end].to_owned();
        rest = rest[name_end..].trim_start();
        if !rest.starts_with('=') {
            continue;
        }
        rest = rest[1..].trim_start();
        let body = type_body(rest);
        rest = &rest[body.len()..];
        if let Some(shape) = classify_ts(body) {
            out.insert(name, shape);
        }
    }
}

fn type_body(src: &str) -> &str {
    let mut depth = 0i32;
    for (i, c) in src.char_indices() {
        match c {
            '{' | '(' | '[' => depth += 1,
            '}' | ')' | ']' => depth -= 1,
            ';' if depth <= 0 => return &src[..=i],
            '\n' if depth <= 0 => {
                let rest = &src[i..];
                if rest.starts_with("\nexport ")
                    || rest.starts_with("\n/**")
                    || rest.starts_with("\n\n")
                {
                    return &src[..i];
                }
            }
            _ => {}
        }
    }
    src
}

fn classify_ts(body: &str) -> Option<TsShape> {
    let trimmed = body.trim().trim_end_matches(';').trim();
    if trimmed.starts_with('{') {
        return Some(TsShape::Object {
            keys: object_keys(trimmed),
        });
    }
    let quotes: Vec<&str> = trimmed
        .split('|')
        .map(str::trim)
        .filter(|p| p.starts_with('\'') || p.starts_with('"'))
        .collect();
    let parts: Vec<&str> = trimmed
        .split('|')
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .collect();
    if !quotes.is_empty() && quotes.len() == parts.len() {
        let values = quotes
            .into_iter()
            .map(|q| q.trim_matches(|c| c == '\'' || c == '"').to_owned())
            .collect();
        return Some(TsShape::StringUnion { values });
    }
    if trimmed.contains('|') {
        return Some(TsShape::Union);
    }
    None
}

fn object_keys(body: &str) -> BTreeSet<String> {
    let mut keys = BTreeSet::new();
    let mut depth = 0i32;
    let chars: Vec<char> = body.chars().collect();
    let mut i = 0usize;
    while i < chars.len() {
        if chars[i] == '/' && i + 1 < chars.len() && chars[i + 1] == '*' {
            i += 2;
            while i + 1 < chars.len() && !(chars[i] == '*' && chars[i + 1] == '/') {
                i += 1;
            }
            i = i.saturating_add(2);
            continue;
        }
        if chars[i] == '/' && i + 1 < chars.len() && chars[i + 1] == '/' {
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
            continue;
        }
        match chars[i] {
            '{' => {
                depth += 1;
                i += 1;
            }
            '}' => {
                depth -= 1;
                i += 1;
            }
            c if depth == 1 && (c.is_ascii_alphabetic() || c == '_') => {
                let mut ident = String::new();
                while i < chars.len() && (chars[i].is_ascii_alphanumeric() || chars[i] == '_') {
                    ident.push(chars[i]);
                    i += 1;
                }
                while i < chars.len() && chars[i].is_whitespace() {
                    i += 1;
                }
                if i < chars.len() && chars[i] == '?' {
                    i += 1;
                    while i < chars.len() && chars[i].is_whitespace() {
                        i += 1;
                    }
                }
                if i < chars.len() && chars[i] == ':' {
                    keys.insert(ident);
                }
            }
            _ => i += 1,
        }
    }
    keys
}

fn rust_wire_names(ty: &IrCoreType) -> BTreeSet<String> {
    match &ty.shape {
        IrCoreShape::Struct { fields, .. } => fields.iter().map(|f| f.wire_name.clone()).collect(),
        IrCoreShape::UnitEnum { variants, .. } => {
            variants.iter().map(|v| v.wire_name.clone()).collect()
        }
        IrCoreShape::TaggedEnum { tag, variants, .. } => {
            let mut names = BTreeSet::from([tag.clone()]);
            for variant in variants {
                names.insert(variant.wire_name.clone());
                for field in &variant.fields {
                    names.insert(field.wire_name.clone());
                }
            }
            names
        }
        IrCoreShape::UntaggedEnum { variants, .. } => {
            let mut names = BTreeSet::new();
            for variant in variants {
                for field in &variant.fields {
                    names.insert(field.wire_name.clone());
                }
            }
            names
        }
    }
}

fn currently_drifts(ty: &IrCoreType, ts: &TsShape) -> bool {
    match (&ty.shape, ts) {
        (IrCoreShape::Struct { .. }, TsShape::Union) => true,
        (IrCoreShape::Struct { .. }, TsShape::Object { keys }) => &rust_wire_names(ty) != keys,
        (IrCoreShape::UnitEnum { .. }, TsShape::StringUnion { values }) => {
            &rust_wire_names(ty) != values
        }
        (IrCoreShape::TaggedEnum { .. }, TsShape::Union) => false,
        (IrCoreShape::UntaggedEnum { .. }, TsShape::Union) => false,
        _ => true,
    }
}

#[test]
fn ts_cross_check_ratchet() {
    let closed = lowered();
    let ts_dir = paths()
        .ts_package("core")
        .expect("tsPackages.core")
        .join("src");
    let ts_types = parse_ts_types(&ts_dir);
    let skip = overlay_skip_rust_names();

    for (name, ty) in &closed {
        if ty.serde == IrCoreSerde::None {
            continue;
        }
        if skip.contains(name) {
            continue;
        }
        let Some(ts) = ts_types.get(name) else {
            continue;
        };
        assert!(
            !currently_drifts(ty, ts),
            "{name} wire names drifted from TS {name} without a boundaryTypesTs rename/reshape\n rust={:?}\n ts={:?}",
            rust_wire_names(ty),
            match ts {
                TsShape::Object { keys } => format!("object {keys:?}"),
                TsShape::StringUnion { values } => format!("union {values:?}"),
                TsShape::Union => "union".into(),
            }
        );
    }
}
