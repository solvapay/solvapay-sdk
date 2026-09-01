//! Golden tests for signature-parity suite emitters.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::fs;

use dto_gen::{
    emit_parity_suite_c, emit_parity_suite_go, emit_parity_suite_py, emit_parity_suite_rb,
    emit_parity_suite_rs, emit_parity_suite_ts, Ir,
};

use crate::support::{
    lower_bindings_ir, lower_catalog_ir, lower_test_ir, rustfmt_source, strip_generated_header,
};

type EmitFn = fn(&Ir) -> dto_gen::GenResult<String>;

#[derive(Clone, Copy)]
enum Fixture {
    Test,
    Catalog,
    Bindings,
}

#[derive(Clone, Copy)]
enum Compare {
    Full,
    StripHeader,
    Rustfmt,
}

struct Case {
    name: &'static str,
    fixture: Fixture,
    emit: EmitFn,
    generated_key: &'static str,
    compare: Compare,
    must_contain: &'static [&'static str],
    must_not_contain: &'static [&'static str],
}

fn load_ir(fixture: Fixture) -> Ir {
    match fixture {
        Fixture::Test => lower_test_ir(),
        Fixture::Catalog => lower_catalog_ir(),
        Fixture::Bindings => lower_bindings_ir(),
    }
}

fn normalize(emitted: &str, committed: &str, compare: Compare, tag: &str) -> (String, String) {
    match compare {
        Compare::Full => (emitted.to_owned(), committed.to_owned()),
        Compare::StripHeader => (
            strip_generated_header(emitted),
            strip_generated_header(committed),
        ),
        Compare::Rustfmt => (rustfmt_source(emitted, tag), committed.to_owned()),
    }
}

#[test]
fn parity_suites_match_committed() {
    let cases = [
        Case {
            name: "ts",
            fixture: Fixture::Test,
            emit: emit_parity_suite_ts,
            generated_key: "tsParity",
            compare: Compare::StripHeader,
            must_contain: &["@generated"],
            must_not_contain: &[],
        },
        Case {
            name: "py",
            fixture: Fixture::Catalog,
            emit: emit_parity_suite_py,
            generated_key: "pyParity",
            compare: Compare::StripHeader,
            must_contain: &[
                "check_limits",
                "10000",
                "test_client_method_census",
                "test_stub_cross_check",
                "['self', 'args_json']",
            ],
            must_not_contain: &[
                "test_client_method_presence",
                "assert async_expected",
                "or True",
                "2 == 2",
            ],
        },
        Case {
            name: "rb",
            fixture: Fixture::Bindings,
            emit: emit_parity_suite_rb,
            generated_key: "rbParity",
            compare: Compare::Full,
            must_contain: &["assert_equal 42"],
            must_not_contain: &["2 == 2", "or true"],
        },
        Case {
            name: "go",
            fixture: Fixture::Bindings,
            emit: emit_parity_suite_go,
            generated_key: "goParity",
            compare: Compare::Full,
            must_contain: &[
                "len(operationSignatures); got != 42",
                "expectedLimitsCacheTTLMs = 10000",
                "expectedMaxRetries = 2",
                "expectedInitialDelayMs = 500",
                "_ = (*solvapay.Client).CheckLimits",
                "TestSyncOnlyMatrix",
                "paramTypes",
                "TestExportedClientMethodsMatchCensus",
                "map[string]interface {}",
            ],
            must_not_contain: &["2 == 2", "|| true"],
        },
        Case {
            name: "rs",
            fixture: Fixture::Bindings,
            emit: emit_parity_suite_rs,
            generated_key: "rsParity",
            compare: Compare::Rustfmt,
            must_contain: &[
                "assert_eq!(OPERATION_SIGNATURES.len(), 42)",
                "_assert_typed_surface",
                "_parity_sink",
            ],
            must_not_contain: &["2 == 2", "or true"],
        },
        Case {
            name: "c",
            fixture: Fixture::Bindings,
            emit: emit_parity_suite_c,
            generated_key: "cParity",
            compare: Compare::Full,
            must_contain: &[
                "nops != 42",
                "(void)&solvapay_client_call",
                "solvapay_abi_version() != SOLVAPAY_ABI_VERSION",
                "unknown op",
                "kRequiredArgs[][kMaxRequired]",
                "json_with_filled",
            ],
            must_not_contain: &["2 == 2", "|| true"],
        },
    ];

    for case in cases {
        let ir = load_ir(case.fixture);
        let emitted = (case.emit)(&ir).unwrap_or_else(|err| panic!("{} emit: {err}", case.name));
        let path = support::paths()
            .generated_path(case.generated_key)
            .unwrap_or_else(|_| panic!("{} path", case.generated_key));
        let committed = fs::read_to_string(&path)
            .unwrap_or_else(|err| panic!("read committed {}: {err}", case.generated_key));
        let (left, right) = normalize(&emitted, &committed, case.compare, case.name);
        assert_eq!(
            left, right,
            "{} parity suite drifted — regenerate with pnpm gen",
            case.name
        );
        for needle in case.must_contain {
            assert!(emitted.contains(needle), "{} missing {needle:?}", case.name);
        }
        for needle in case.must_not_contain {
            assert!(
                !emitted.contains(needle),
                "{} unexpectedly contains {needle:?}",
                case.name
            );
        }
    }
}

#[test]
fn emit_parity_suite_ts_mutated_defaults_change_output() {
    let ir = lower_test_ir();
    let baseline = emit_parity_suite_ts(&ir).expect("emit");
    let mut mutated = ir;
    let entry = mutated
        .entry_points
        .values_mut()
        .next()
        .expect("entry point");
    entry.defaults.max_retries = entry.defaults.max_retries.saturating_add(1);
    let perturbed = emit_parity_suite_ts(&mutated).expect("emit mutated");
    assert_ne!(baseline, perturbed);
}
