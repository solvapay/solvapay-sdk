//! Guard: no `CARGO_MANIFEST_DIR` hop-arithmetic outside the allowlist (Cycle 6).

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::fs;
use std::path::{Path, PathBuf};

use repo_paths::try_repo_root;

const ALLOWLIST: &[&str] = &[
    "tools/shared/repo-paths/src/lib.rs",
    "tools/shared/repo-paths/tests/layout.rs",
    "tools/shared/repo-paths/tests/no_hardcoded_paths.rs",
    "sdks/capi/build.rs",
    "sdks/capi/tests/header_golden.rs",
    "examples/rust/env/src/lib.rs",
];

fn rust_roots(repo: &Path) -> Vec<PathBuf> {
    ["core", "sdks", "tools", "examples", "internal"]
        .into_iter()
        .map(|name| repo.join(name))
        .filter(|p| p.is_dir())
        .collect()
}

fn walk_rs(dir: &Path, acc: &mut Vec<PathBuf>) {
    let entries = fs::read_dir(dir).unwrap_or_else(|err| panic!("read {}: {err}", dir.display()));
    for entry in entries {
        let entry = entry.unwrap();
        let path = entry.path();
        if path.is_dir() {
            if path
                .file_name()
                .is_some_and(|name| name == "target" || name == "node_modules" || name == ".git")
            {
                continue;
            }
            walk_rs(&path, acc);
        } else if path.extension().is_some_and(|ext| ext == "rs") {
            acc.push(path);
        }
    }
}

/// Replace comment bodies so doc mentions are ignored; keep string literals
/// because `env!("CARGO_MANIFEST_DIR")` stores the name in a literal.
fn strip_comments(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'/' && i + 1 < bytes.len() && bytes[i + 1] == b'/' {
            while i < bytes.len() && bytes[i] != b'\n' {
                out.push(' ');
                i += 1;
            }
            continue;
        }
        if bytes[i] == b'/' && i + 1 < bytes.len() && bytes[i + 1] == b'*' {
            out.push(' ');
            out.push(' ');
            i += 2;
            while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                out.push(if bytes[i] == b'\n' { '\n' } else { ' ' });
                i += 1;
            }
            if i + 1 < bytes.len() {
                out.push(' ');
                out.push(' ');
                i += 2;
            }
            continue;
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}

#[test]
fn no_cargo_manifest_dir_outside_allowlist() {
    let repo = try_repo_root().unwrap();
    let mut files = Vec::new();
    for dir in rust_roots(&repo) {
        walk_rs(&dir, &mut files);
    }
    files.sort();
    let mut violations = Vec::new();
    for file in files {
        let rel = file
            .strip_prefix(&repo)
            .unwrap()
            .to_string_lossy()
            .replace('\\', "/");
        if ALLOWLIST.contains(&rel.as_str()) {
            continue;
        }
        let src = fs::read_to_string(&file).unwrap();
        let code = strip_comments(&src);
        if code.contains("CARGO_MANIFEST_DIR") {
            violations.push(rel);
        }
    }
    assert!(
        violations.is_empty(),
        "CARGO_MANIFEST_DIR outside allowlist:\n  {}",
        violations.join("\n  ")
    );
}
