//! Writes Arbitrary-stable length-prefixed seeds into `internal/fuzz/corpus/<target>/`.
//!
//! Source of truth: `contract/fixtures/webhook-verification/*.json` and
//! `contract/fixtures/client/**` (step 55-a corpus seed strategy).

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;
use solvapay_c::fuzz_oracle::{HandleOp, HandleSequence};
use solvapay_core::fuzz_oracle::{EnvelopeFuzzInput, WebhookFuzzInput};

fn main() {
    let layout = match repo_paths::load() {
        Ok(paths) => paths,
        Err(err) => {
            eprintln!("seed-corpus: {err}");
            std::process::exit(1);
        }
    };
    let fuzz_root = match layout.lookup("fuzzRoot") {
        Ok(path) => path,
        Err(err) => {
            eprintln!("seed-corpus: {err}");
            std::process::exit(1);
        }
    };
    let contract = match layout.contract_fixtures() {
        Ok(path) => path,
        Err(err) => {
            eprintln!("seed-corpus: {err}");
            std::process::exit(1);
        }
    };

    if write_webhook_seeds(&fuzz_root, &contract.join("webhook-verification")).is_none() {
        eprintln!("seed-corpus: failed to write webhook seeds");
        std::process::exit(1);
    }
    if write_envelope_seeds(&fuzz_root, &contract.join("client")).is_none() {
        eprintln!("seed-corpus: failed to write envelope seeds");
        std::process::exit(1);
    }
    if write_handle_seeds(&fuzz_root).is_none() {
        eprintln!("seed-corpus: failed to write handle seeds");
        std::process::exit(1);
    }
    println!("seed-corpus: wrote internal/fuzz/corpus/{{webhook_verify,envelope_args,c_handle}}");
}

fn write_webhook_seeds(fuzz_root: &Path, dir: &Path) -> Option<()> {
    let out = fuzz_root.join("corpus/webhook_verify");
    fs::create_dir_all(&out).ok()?;
    for path in json_files(dir) {
        let value = read_json(&path)?;
        let args = value.pointer("/input/args")?;
        let body = args.get("body")?.as_str()?.to_owned();
        let signature = args
            .get("signature")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned();
        let secret = args.get("secret")?.as_str()?.to_owned();
        let clock = value.pointer("/input/clock")?.as_str()?;
        let now_unix_secs = parse_rfc3339_unix(clock)?;
        let input = WebhookFuzzInput {
            body,
            signature,
            secret,
            now_unix_secs,
        };
        let name = file_stem(&path);
        fs::write(out.join(&name), input.encode()).ok()?;
    }
    Some(())
}

fn write_envelope_seeds(fuzz_root: &Path, dir: &Path) -> Option<()> {
    let out = fuzz_root.join("corpus/envelope_args");
    fs::create_dir_all(&out).ok()?;
    for path in json_files(dir) {
        let value = read_json(&path)?;
        let op = value
            .pointer("/input/fn")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_owned();
        let args = value.pointer("/input/args").cloned().unwrap_or(Value::Null);
        let args_json = serde_json::to_string(&args).ok()?;
        let input = EnvelopeFuzzInput { op, args_json };
        let rel = path.strip_prefix(dir).ok()?;
        let name = rel.to_string_lossy().replace(['/', '\\'], "__");
        fs::write(out.join(name), input.encode()).ok()?;
    }
    Some(())
}

fn write_handle_seeds(fuzz_root: &Path) -> Option<()> {
    let out = fuzz_root.join("corpus/c_handle");
    fs::create_dir_all(&out).ok()?;
    let seeds: [(&str, HandleSequence); 7] = [
        (
            "smoke_create_call_free",
            HandleSequence {
                ops: vec![
                    HandleOp::New {
                        config_json: r#"{"apiKey":"sk_test"}"#.to_owned(),
                    },
                    HandleOp::Call {
                        slot: 0,
                        op: "getMerchant".to_owned(),
                        args: "{}".to_owned(),
                    },
                    HandleOp::Free { slot: 0 },
                ],
            },
        ),
        (
            "smoke_use_after_free",
            HandleSequence {
                ops: vec![
                    HandleOp::New {
                        config_json: r#"{"apiKey":"sk_test"}"#.to_owned(),
                    },
                    HandleOp::Free { slot: 0 },
                    HandleOp::Call {
                        slot: 0,
                        op: "getMerchant".to_owned(),
                        args: "{}".to_owned(),
                    },
                ],
            },
        ),
        (
            "smoke_garbage_handle",
            HandleSequence {
                ops: vec![HandleOp::UseRaw { raw: 0xDEAD_BEEF }],
            },
        ),
        (
            "double_free",
            HandleSequence {
                ops: vec![
                    HandleOp::New {
                        config_json: r#"{"apiKey":"sk_test"}"#.to_owned(),
                    },
                    HandleOp::Free { slot: 0 },
                    HandleOp::Free { slot: 0 },
                ],
            },
        ),
        (
            "null_handle_call",
            HandleSequence {
                ops: vec![HandleOp::CallNullHandle {
                    op: "getMerchant".to_owned(),
                    args: "{}".to_owned(),
                }],
            },
        ),
        (
            "null_args_client_new",
            HandleSequence {
                ops: vec![HandleOp::NewNullConfig, HandleOp::NewNullOut],
            },
        ),
        (
            "unknown_op_on_live_handle",
            HandleSequence {
                ops: vec![
                    HandleOp::New {
                        config_json: r#"{"apiKey":"sk_test"}"#.to_owned(),
                    },
                    HandleOp::Call {
                        slot: 0,
                        op: "noSuchOp".to_owned(),
                        args: "{}".to_owned(),
                    },
                    HandleOp::Free { slot: 0 },
                ],
            },
        ),
    ];
    for (name, seq) in seeds {
        fs::write(out.join(name), seq.encode()).ok()?;
    }
    Some(())
}

fn json_files(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    walk(dir, &mut out);
    out.sort();
    out
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk(&path, out);
        } else if path.extension().is_some_and(|ext| ext == "json") {
            out.push(path);
        }
    }
}

fn read_json(path: &Path) -> Option<Value> {
    let bytes = fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn file_stem(path: &Path) -> String {
    path.file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "seed".to_owned())
}

/// Parses `YYYY-MM-DDTHH:MM:SSZ` into unix seconds (UTC, no leap seconds).
fn parse_rfc3339_unix(s: &str) -> Option<i64> {
    let (date, rest) = s.split_once('T')?;
    let time = rest.strip_suffix('Z').unwrap_or(rest);
    let mut d = date.split('-');
    let year: i64 = d.next()?.parse().ok()?;
    let month: i64 = d.next()?.parse().ok()?;
    let day: i64 = d.next()?.parse().ok()?;
    let mut t = time.split(':');
    let hour: i64 = t.next()?.parse().ok()?;
    let minute: i64 = t.next()?.parse().ok()?;
    let second: i64 = t.next()?.parse().ok()?;
    let days = days_from_civil(year, month, day)?;
    Some(days * 86_400 + hour * 3_600 + minute * 60 + second)
}

fn days_from_civil(year: i64, month: i64, day: i64) -> Option<i64> {
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let mut y = year;
    let m = month;
    if m <= 2 {
        y -= 1;
    }
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = if m > 2 { m - 3 } else { m + 9 };
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some(era * 146_097 + doe - 719_468)
}
