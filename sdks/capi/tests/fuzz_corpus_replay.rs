//! Stable corpus replay for C dispatch + handle-misuse oracles (step 55-a).

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::fs;
use std::path::{Path, PathBuf};

use solvapay_c::fuzz_oracle::{check_c_dispatch_envelope, check_handle_sequence, HandleSequence};
use solvapay_core::fuzz_oracle::EnvelopeFuzzInput;

fn corpus_dir(target: &str) -> PathBuf {
    repo_paths::load()
        .expect("repo-paths")
        .lookup("fuzzCorpus")
        .expect("fuzzCorpus")
        .join(target)
}

fn replay_files(dir: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let Ok(entries) = fs::read_dir(dir) else {
        return files;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            files.push(path);
        }
    }
    files.sort();
    files
}

#[test]
fn envelope_corpus_replays_through_c_dispatch() {
    let dir = corpus_dir("envelope_args");
    let files = replay_files(&dir);
    assert!(
        !files.is_empty(),
        "committed corpus missing at {}",
        dir.display()
    );
    for path in files {
        let bytes = fs::read(&path).unwrap_or_else(|err| panic!("read {}: {err}", path.display()));
        let input = EnvelopeFuzzInput::decode(&bytes)
            .unwrap_or_else(|| panic!("decode envelope corpus {}", path.display()));
        check_c_dispatch_envelope(&input.op, &input.args_json)
            .unwrap_or_else(|err| panic!("{}: {err:?}", path.display()));
    }
}

#[test]
fn handle_corpus_replays_without_panic() {
    let dir = corpus_dir("c_handle");
    let files = replay_files(&dir);
    assert!(
        !files.is_empty(),
        "committed corpus missing at {}",
        dir.display()
    );
    for path in files {
        let bytes = fs::read(&path).unwrap_or_else(|err| panic!("read {}: {err}", path.display()));
        let seq = HandleSequence::decode(&bytes)
            .unwrap_or_else(|| panic!("decode handle corpus {}", path.display()));
        check_handle_sequence(&seq).unwrap_or_else(|err| panic!("{}: {err:?}", path.display()));
    }
}
