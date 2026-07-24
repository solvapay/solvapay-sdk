//! Full Ruby generator orchestration is byte-idempotent.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use dto_gen::generate_from_snapshot;

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3)
        .expect("repo root")
        .to_path_buf()
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
            &root().join("contract/openapi/sdk-v1.snapshot.json"),
            &dto,
            Some(&root().join("contract/manifest/sdk-contract.yaml")),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            Some(&shims),
            None,
            None,
            None,
            None,
            None,
            None,
            Some(&native),
            Some(&client),
            Some(&rbs),
            Some(&parity),
            None,
            None,
            None,
            None,
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
