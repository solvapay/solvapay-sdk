//! Layout loader tests (Cycle 5).

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::fs;

use repo_paths::{load, try_repo_root, try_repo_root_from};

#[test]
fn try_repo_root_finds_pnpm_workspace_yaml() {
    let root = try_repo_root().expect("repo root from crate manifest dir");
    assert!(root.join("pnpm-workspace.yaml").is_file());
    let pkg = fs::read_to_string(root.join("package.json")).expect("package.json");
    assert!(pkg.contains("solvapay-sdk-monorepo"));
}

#[test]
fn try_repo_root_from_markerless_temp_dir_errors() {
    let dir = std::env::temp_dir().join(format!(
        "repo-paths-empty-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos()
    ));
    fs::create_dir_all(&dir).expect("temp dir");
    let err = try_repo_root_from(&dir).expect_err("marker-less tree must fail");
    let _ = fs::remove_dir_all(&dir);
    let msg = err.to_string();
    assert!(
        msg.contains("pnpm-workspace.yaml"),
        "unexpected error: {msg}"
    );
}

#[test]
fn contract_and_client_fixtures_exist() {
    let paths = load().expect("load manifest");
    let contract = paths.contract_fixtures().expect("fixtures");
    let client = paths.client_fixtures().expect("client fixtures");
    assert!(contract.is_dir(), "{}", contract.display());
    assert!(client.is_dir(), "{}", client.display());
}

#[test]
fn every_generated_path_exists() {
    let paths = load().expect("load manifest");
    for entry in &paths.manifest().generated {
        let abs = paths.abs(&entry.path);
        assert!(
            abs.exists(),
            "generated {} missing at {}",
            entry.id,
            abs.display()
        );
    }
}

#[test]
fn core_dir_and_sdk_surfaces_exist() {
    let paths = load().expect("load manifest");
    assert_eq!(
        paths.manifest().dirs.get("core").map(String::as_str),
        Some("core")
    );
    assert!(
        !paths.manifest().dirs.contains_key("rust"),
        "dirs.rust must be dropped after the Tier 3 hoist"
    );
    assert_eq!(
        paths.manifest().sdks.get("typescript").map(String::as_str),
        Some("sdks/typescript")
    );
    assert!(
        !paths.root().join("packages").exists(),
        "top-level packages/ must be gone after the Tier 4 split"
    );
    for key in [
        "node-native",
        "wasm",
        "python",
        "pythonMcp",
        "ruby",
        "rubyMcp",
        "rustMcp",
        "go",
        "capi",
        "rust",
        "typescript",
    ] {
        let rel = paths
            .manifest()
            .sdks
            .get(key)
            .unwrap_or_else(|| panic!("missing sdk {key}"));
        let abs = paths.abs(rel);
        assert!(abs.exists(), "sdk {key} missing at {}", abs.display());
    }
    for rel in [
        "sdks/typescript/server",
        "sdks/typescript/core",
        "sdks/typescript/auth",
        "sdks/typescript/mcp",
        "sdks/typescript/mcp-core",
        "sdks/typescript/next",
        "sdks/typescript/react",
        "sdks/typescript/react-supabase",
        "tools/cli",
        "tools/create-solvapay",
        "tools/init",
        "internal/demo-services",
        "internal/test-utils",
        "internal/tsconfig",
    ] {
        let abs = paths.abs(rel);
        assert!(abs.exists(), "{rel} missing at {}", abs.display());
    }
}

#[test]
fn generated_ids_match_enumerated_expectation() {
    let paths = load().expect("load manifest");
    let ids: Vec<&str> = paths.generated_ids();
    let expected = [
        "rustDto",
        "tsOverlays",
        "tsClient",
        "tsGenerated",
        "tsParity",
        "bindingSymbols",
        "boundaryTypes",
        "coreTypesTs",
        "coreDispatchTs",
        "coreNativeTs",
        "coreHelpersTs",
        "serverDecisionsTs",
        "nodeBindings",
        "wasmBindings",
        "pythonBindings",
        "rubyBindings",
        "nativeTs",
        "wasmTs",
        "nativePy",
        "pyStub",
        "pyParity",
        "pyConformance",
        "nativeRb",
        "rbClient",
        "rubyHelpers",
        "rbRbs",
        "rbParity",
        "rbConformance",
        "rsClient",
        "rsBlocking",
        "rsParity",
        "goBindings",
        "goClient",
        "goParity",
        "goConformance",
        "cBindings",
        "cConformance",
        "cParity",
        "fixtureRunner",
    ];
    assert_eq!(ids, expected);
}

#[test]
fn try_repo_root_from_nested_scripts_dir() {
    let root = try_repo_root().unwrap();
    let nested = root.join("tools").join("shared");
    assert_eq!(try_repo_root_from(&nested).unwrap(), root);
}
