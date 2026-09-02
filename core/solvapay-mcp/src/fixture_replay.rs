//! Replay `contract/mcp-fixtures/` against sync dispatch + the engine.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, missing_docs)]

// `check-no-unwrap.sh` only skips unwraps inside a `#[cfg(test)]` item in this file.
#[cfg(test)]
mod replay {
    use std::fs;
    use std::path::Path;

    use serde_json::Value;

    use crate::dispatch_sync;
    use crate::engine::{mcp_handle_request, mcp_resume, HandleRequestInput, ResumeInput};

    fn discover(root: &Path) -> Vec<String> {
        fn walk(dir: &Path, root: &Path, out: &mut Vec<String>) {
            for entry in fs::read_dir(dir).unwrap() {
                let path = entry.unwrap().path();
                if path.is_dir() {
                    walk(&path, root, out);
                } else if path.extension().and_then(|e| e.to_str()) == Some("json") {
                    out.push(
                        path.strip_prefix(root)
                            .unwrap()
                            .to_string_lossy()
                            .replace('\\', "/"),
                    );
                }
            }
        }
        let mut rels = Vec::new();
        walk(root, root, &mut rels);
        rels.sort();
        rels
    }

    fn load(root: &Path, rel: &str) -> Value {
        serde_json::from_str(&fs::read_to_string(root.join(rel)).unwrap()).unwrap()
    }

    fn envelope_value(env: &str) -> Value {
        let parsed: Value = serde_json::from_str(env).unwrap();
        assert_eq!(parsed["ok"], true, "envelope {env}");
        parsed["value"].clone()
    }

    #[test]
    fn engine_does_not_author_gate_copy() {
        let src = include_str!("engine.rs");
        assert!(
            !src.contains("You don't have an active plan"),
            "gate copy must come from layer-2 paywall_tool_result, not the engine"
        );
    }

    #[test]
    fn replays_sync_mcp_fixtures() {
        let root = repo_paths::load().unwrap().lookup("mcpFixtures").unwrap();
        for rel in discover(&root) {
            let fixture = load(&root, &rel);
            let fn_name = fixture["input"]["fn"].as_str().unwrap();
            if matches!(
                fn_name,
                "registerPayable"
                    | "mcpBootstrap"
                    | "mcpCallBuiltinTool"
                    | "mcpOauthRequest"
                    | "mcpDispatch"
                    | "mcpResolveAuth"
            ) {
                continue;
            }
            let args = fixture["input"]["args"].clone();
            let expect = fixture["expect"]["result"].clone();
            match fn_name {
                "mcpHandleRequest" => {
                    let input: HandleRequestInput =
                        serde_json::from_value(args.clone()).expect(&rel);
                    let got = mcp_handle_request(&input).expect(&rel);
                    if rel.contains("tools-list") {
                        assert_eq!(got["kind"], "rpc", "{rel}");
                        let tools = got["rpc"]["result"]["tools"].as_array().unwrap();
                        assert!(tools.len() >= 8, "{rel}");
                        for tool in tools {
                            let title = tool.get("title");
                            assert!(
                                title.is_none() || title.is_some_and(Value::is_string),
                                "{rel} tool {} title must be a string or omitted, got {title:?}",
                                tool["name"]
                            );
                        }
                        if rel.ends_with("tools-list-modern.json") {
                            assert_eq!(got["rpc"]["result"]["resultType"], "complete", "{rel}");
                            assert_eq!(got["rpc"]["result"]["ttlMs"], 60_000, "{rel}");
                            assert_eq!(got["rpc"]["result"]["cacheScope"], "public", "{rel}");
                        }
                        if rel.ends_with("tools-list-payable.json") {
                            let echo = tools
                                .iter()
                                .find(|t| t["name"] == "echo_paid")
                                .expect("payable advertised");
                            assert_eq!(echo["title"], "Echo paid", "{rel}");
                            assert_eq!(
                                echo["description"], "Echo arguments after a paid gate",
                                "{rel}"
                            );
                            assert_eq!(
                                echo["inputSchema"],
                                serde_json::json!({
                                    "type": "object",
                                    "properties": { "n": { "type": "number" } }
                                }),
                                "{rel}"
                            );
                        }
                        continue;
                    }
                    if rel.ends_with("invoke-handler.json") {
                        assert_eq!(got["kind"], "invokeHandler", "{rel}");
                        assert_eq!(got["tool"], expect["tool"], "{rel}");
                        assert_eq!(got["args"], expect["args"], "{rel}");
                        assert_eq!(got["customerRef"], expect["customerRef"], "{rel}");
                        assert!(got["token"].as_str().unwrap().len() > 8, "{rel}");
                        continue;
                    }
                    assert_eq!(got, expect, "{rel}");
                }
                "mcpResume" => {
                    let input: ResumeInput = serde_json::from_value(args.clone()).unwrap();
                    let got = mcp_resume(&input).expect(&rel);
                    assert_eq!(got, expect, "{rel}");
                }
                _ => {
                    let env = dispatch_sync(fn_name, &args.to_string());
                    let got = envelope_value(&env);
                    assert_eq!(got, expect, "{rel}");
                }
            }
        }
    }
}
