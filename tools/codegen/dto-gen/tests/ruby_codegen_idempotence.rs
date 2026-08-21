//! Full Ruby generator orchestration is byte-idempotent.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::collections::BTreeMap;
use std::fs;

use dto_gen::{generate_from_snapshot, GenOutputs};

fn paths() -> repo_paths::RepoPaths {
    repo_paths::load().expect("repo-paths")
}

#[test]
fn emits_all_ruby_artifacts_identically_twice() {
    let temp = std::env::temp_dir().join(format!("dto-gen-ruby-{}", std::process::id()));
    let _ = fs::remove_dir_all(&temp);
    fs::create_dir_all(&temp).expect("create temp");
    let dto = temp.join("dto");
    let shims = temp.join("ext");
    let lib = temp.join("lib");
    let native = lib.join("_native.rb");
    let client = lib.join("client.rb");
    let rbs = temp.join("sig/solvapay.rbs");
    let parity = temp.join("test/signature_parity_generated_test.rb");
    let generate = || {
        generate_from_snapshot(
            &paths()
                .contract_input("openapiSnapshot")
                .expect("openapiSnapshot"),
            &dto,
            Some(&paths().contract_input("sdkManifest").expect("sdkManifest")),
            Some(&paths().contract_input("coreSrc").expect("coreSrc")),
            Some(
                &paths()
                    .contract_input("bindingResidue")
                    .expect("bindingResidue"),
            ),
            Some(
                &paths()
                    .contract_input("transportSrc")
                    .expect("transportSrc"),
            ),
            &GenOutputs {
                ruby_bindings_out: Some(&shims),
                native_rb_out: Some(&native),
                rb_client_out: Some(&client),
                rb_rbs_out: Some(&rbs),
                rb_parity_out: Some(&parity),
                ..GenOutputs::default()
            },
        )
        .expect("generate Ruby")
    };
    generate();
    let paths = [
        shims.join("args.rs"),
        shims.join("decisions.rs"),
        shims.join("payload_builders.rs"),
        shims.join("client.rs"),
        shims.join("register.rs"),
        native.clone(),
        client.clone(),
        lib.join("helpers.generated.rb"),
        rbs.clone(),
        parity.clone(),
    ];
    let first: BTreeMap<_, _> = paths
        .iter()
        .map(|path| (path.clone(), fs::read(path).expect("read first output")))
        .collect();
    generate();
    for path in paths {
        assert_eq!(
            first.get(&path).expect("first output"),
            &fs::read(&path).expect("read second output"),
            "{} drifted across identical runs",
            path.display()
        );
    }
    fs::remove_dir_all(temp).expect("remove temp");
}
