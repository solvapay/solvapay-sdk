//! Golden: emitted `boundary.generated.d.ts` matches today's public TS surface.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::Path;

use dto_gen::emit_core_types_ts::emit_core_types_ts;
use dto_gen::ir::{Ir, IrErrorTemplates};
use dto_gen::manifest::Manifest;

/// Hand-written modules whose `export type` / `export interface` names must
/// survive on the generated boundary surface.
const PURE_TYPE_FILES: &[&str] = &[
    "customer-sync.ts",
    "payment.ts",
    "checkout.ts",
    "product.ts",
    "limits.ts",
    "plans.ts",
    "error.ts",
    "paywall-decision.ts",
    "usage.ts",
    "activation.ts",
    "product-readiness.ts",
    "renewal.ts",
];

/// Types that live in mixed modules but still come from the boundary emitter.
const MIXED_GENERATED_NAMES: &[&str] = &[
    "BusinessDetails",
    "BusinessDetailsInput",
    "BusinessDetailsValidationError",
    "BusinessDetailsValidationIssue",
    "ValidateBusinessDetailsResult",
    "SellerIdentityDisplay",
    "SellerIdentityRow",
];

#[derive(Debug, Clone, PartialEq, Eq)]
enum TsShape {
    Object {
        required: BTreeSet<String>,
        optional: BTreeSet<String>,
    },
    StringUnion {
        values: BTreeSet<String>,
    },
    Union,
}

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

fn extract_types(src: &str, out: &mut BTreeMap<String, TsShape>) {
    let mut rest = src;
    while let Some(idx) = find_export(rest) {
        rest = &rest[idx..];
        let is_iface = rest.starts_with("export interface ");
        let prefix = if is_iface {
            "export interface "
        } else {
            "export type "
        };
        rest = &rest[prefix.len()..];
        let name_end = rest
            .find(|c: char| !c.is_ascii_alphanumeric() && c != '_')
            .unwrap_or(rest.len());
        let name = rest[..name_end].to_owned();
        rest = rest[name_end..].trim_start();
        if rest.starts_with('<') {
            rest = skip_generics(rest);
            rest = rest.trim_start();
        }
        if is_iface {
            if !rest.starts_with('{') {
                continue;
            }
        } else if rest.starts_with('{') && !rest.contains('=') {
            // `export type { Foo } from '...'` re-export — skip.
            continue;
        } else if rest.starts_with('=') {
            rest = rest[1..].trim_start();
        } else {
            continue;
        }
        let body = type_body(rest);
        rest = &rest[body.len()..];
        if name.is_empty() {
            continue;
        }
        if let Some(shape) = classify_ts(body) {
            out.insert(name, shape);
        }
    }
}

fn find_export(src: &str) -> Option<usize> {
    let a = src.find("export type ");
    let b = src.find("export interface ");
    match (a, b) {
        (Some(x), Some(y)) => Some(x.min(y)),
        (Some(x), None) | (None, Some(x)) => Some(x),
        (None, None) => None,
    }
}

fn skip_generics(src: &str) -> &str {
    let mut depth = 0i32;
    for (i, c) in src.char_indices() {
        match c {
            '<' => depth += 1,
            '>' => {
                depth -= 1;
                if depth == 0 {
                    return src[i + 1..].trim_start();
                }
            }
            _ => {}
        }
    }
    src
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
    let trimmed = trimmed.trim_start_matches('|').trim();
    if trimmed.starts_with('{') {
        let (required, optional) = object_keys(trimmed);
        return Some(TsShape::Object { required, optional });
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

fn object_keys(body: &str) -> (BTreeSet<String>, BTreeSet<String>) {
    let mut required = BTreeSet::new();
    let mut optional = BTreeSet::new();
    let mut depth = 0i32;
    let chars: Vec<char> = body.chars().collect();
    let mut i = 0usize;
    while i < chars.len() {
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
                let mut is_optional = false;
                if i < chars.len() && chars[i] == '?' {
                    is_optional = true;
                    i += 1;
                    while i < chars.len() && chars[i].is_whitespace() {
                        i += 1;
                    }
                }
                if i < chars.len() && chars[i] == ':' {
                    if is_optional {
                        optional.insert(ident);
                    } else {
                        required.insert(ident);
                    }
                }
            }
            _ => i += 1,
        }
    }
    (required, optional)
}

fn handwritten_surface(core_src: &Path) -> BTreeMap<String, TsShape> {
    let mut out = BTreeMap::new();
    for file in PURE_TYPE_FILES {
        let src = fs::read_to_string(core_src.join(file)).expect(file);
        extract_types(&src, &mut out);
    }
    let mixed_src = [
        fs::read_to_string(core_src.join("business-details.ts")).expect("business-details"),
        fs::read_to_string(core_src.join("seller-identity.ts")).expect("seller-identity"),
    ]
    .join("\n");
    let mut mixed = BTreeMap::new();
    extract_types(&mixed_src, &mut mixed);
    for name in MIXED_GENERATED_NAMES {
        if let Some(shape) = mixed.remove(*name) {
            out.insert((*name).to_owned(), shape);
        }
    }
    let generated = core_src.join("types/boundary.generated.d.ts");
    if generated.is_file() {
        let src = fs::read_to_string(&generated).expect("generated boundary");
        extract_types(&src, &mut out);
    }
    assert!(
        !out.is_empty(),
        "hand-written/generated boundary surface was empty"
    );
    out
}

#[test]
fn emitted_surface_matches_handwritten() {
    let ir = lower_ir();
    let emitted = emit_core_types_ts(&ir).expect("emit");
    assert!(
        emitted.contains("@generated"),
        "emitted file must carry @generated"
    );

    let mut got = BTreeMap::new();
    extract_types(&emitted, &mut got);

    let want = handwritten_surface(&paths().abs("packages/core/src"));

    let got_names: BTreeSet<_> = got.keys().cloned().collect();
    let want_names: BTreeSet<_> = want.keys().cloned().collect();
    assert_eq!(
        got_names,
        want_names,
        "exported type names drifted\n extra={:?}\n missing={:?}",
        got_names.difference(&want_names).collect::<Vec<_>>(),
        want_names.difference(&got_names).collect::<Vec<_>>()
    );

    for (name, want_shape) in &want {
        let got_shape = got.get(name).unwrap();
        assert_eq!(
            got_shape, want_shape,
            "shape mismatch for {name}\n got={got_shape:?}\n want={want_shape:?}"
        );
    }
}
