//! Emit generated napi / wasm-bindgen / PyO3 / Magnus shim files
//! (steps 39G-b / 40 / 41 / 43).
//!
//! Node + Wasm each get four files: `args.rs`, `decisions.rs`,
//! `payload_builders.rs`, and the async client (`native_client.rs` /
//! `wasm_client.rs`). Python (Step 41) emits the same four plus a
//! `register.rs` that wires every `#[pyfunction]` into the `_solvapay`
//! module; the client surface is async `future_into_py` + blocking twins.
//! Ruby (Step 43 scaffold) emits only an allowlisted hello-world `client.rs`
//! (`getMerchant`); full surface lands in Step 44.
//! Per-symbol bodies come from [`crate::ir`]; the surrounding "chrome"
//! (module headers, `args.rs`, test trailers, client preamble/postamble, and
//! the wasm MCP module scaffold) is loaded from the committed
//! `assets/binding-emit.snapshot.json`.
//!
//! Output is not final: callers run `rustfmt` over each file (see
//! [`crate::write_file`] / `rustfmt_files`), which normalizes indentation and
//! blank lines. This emitter is responsible only for correct tokens, comment
//! text, ordering, and one-blank-line separation between items.

use serde_json::Value;

use crate::error::{GenError, GenResult};
use crate::header::generated_header;
use crate::ir::{
    Ir, IrBindingArg, IrBindingArtifact, IrBindingCall, IrBindingSymbol, IrExtractKind,
    IrSerializeKind, IrTypedStyle,
};

/// Target binding toolchain.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Toolchain {
    /// napi-rs Node addon (`sdks/node-native/src`).
    Node,
    /// wasm-bindgen edge/browser bundle (`sdks/wasm/src`).
    Wasm,
    /// PyO3 Python extension (`sdks/python/src`).
    Python,
    /// Magnus Ruby extension (`sdks/ruby/ext/solvapay/src`).
    Ruby,
    /// wazero WASI guest crate (`sdks/go/wasm/src`).
    Go,
    /// Native C ABI (`sdks/capi/src`).
    C,
}

/// The generated shim files for one toolchain.
#[derive(Debug, Clone, PartialEq)]
pub struct EmittedBindings {
    /// `args.rs`.
    pub args_rs: String,
    /// `decisions.rs`.
    pub decisions_rs: String,
    /// `payload_builders.rs`.
    pub payload_builders_rs: String,
    /// `native_client.rs` (Node), `wasm_client.rs` (Wasm), or `client.rs` (Python/Ruby/Go).
    pub client_rs: String,
    /// Go-only `webhook.rs` (`sv_verify_webhook` guest export). Empty otherwise.
    pub webhook_rs: String,
    /// Python-only `register.rs` (`#[pymodule]` wiring). Empty for Node/Wasm/Ruby/Go.
    pub register_rs: String,
}

const SNAPSHOT: &str = include_str!("../assets/binding-emit.snapshot.json");
const C_SNAPSHOT: &str = include_str!("../assets/c-emit.snapshot.json");

/// Section id whose payload symbols live in the wasm `mcp_payload` module.
const MCP_SECTION: &str = "MCP payload / descriptors";

/// Emits the four shim files for `toolchain` from the lowered IR.
///
/// # Errors
///
/// Returns [`GenError::Parse`] when the embedded chrome snapshot is missing an
/// expected field, or a symbol references chrome that is not present.
pub fn emit_bindings(ir: &Ir, toolchain: Toolchain) -> GenResult<EmittedBindings> {
    let chrome: Value = serde_json::from_str(SNAPSHOT)
        .map_err(|e| GenError::Parse(format!("invalid binding-emit snapshot: {e}")))?;
    let lang = match toolchain {
        Toolchain::Node => "node",
        Toolchain::Wasm => "wasm",
        Toolchain::Python => "python",
        Toolchain::Ruby => "ruby",
        Toolchain::Go => "go",
        Toolchain::C => "c",
    };

    // The wazero WASI guest (Step 49) carries its chrome inline below rather
    // than in the JSON snapshot: its shims are `#[no_mangle] extern "C"`
    // exports over the guest-memory ABI, not `impl`-block methods, so they do
    // not reuse the shared client/decision emitters.
    if toolchain == Toolchain::Go {
        return Ok(EmittedBindings {
            args_rs: emit_go_args(),
            decisions_rs: emit_go_decisions(ir)?,
            payload_builders_rs: emit_go_payload_builders(ir)?,
            client_rs: emit_go_client(ir)?,
            webhook_rs: emit_go_webhook(),
            register_rs: String::new(),
        });
    }

    if toolchain == Toolchain::C {
        return Ok(EmittedBindings {
            args_rs: String::new(),
            decisions_rs: String::new(),
            payload_builders_rs: String::new(),
            client_rs: emit_c_client(ir)?,
            webhook_rs: String::new(),
            register_rs: String::new(),
        });
    }

    let art = chrome
        .get("artifacts")
        .and_then(|a| a.get(lang))
        .ok_or_else(|| GenError::Parse(format!("snapshot missing artifacts.{lang}")))?;

    match toolchain {
        Toolchain::Ruby => {
            let python_art = chrome
                .get("artifacts")
                .and_then(|a| a.get("python"))
                .ok_or_else(|| GenError::Parse("snapshot missing artifacts.python".into()))?;
            Ok(EmittedBindings {
                args_rs: with_generated_header(
                    chrome_str(python_art, &["argsRs"])?,
                    Toolchain::Ruby,
                ),
                decisions_rs: emit_ruby_sync_artifact(ir, python_art, "decisions")?,
                payload_builders_rs: emit_ruby_payload_builders(ir, python_art)?,
                client_rs: emit_ruby_client(ir, art)?,
                webhook_rs: String::new(),
                register_rs: emit_ruby_register(ir),
            })
        }
        Toolchain::Python => Ok(EmittedBindings {
            args_rs: with_generated_header(chrome_str(art, &["argsRs"])?, Toolchain::Python),
            decisions_rs: emit_decisions(ir, toolchain, art)?,
            payload_builders_rs: emit_payload_builders(ir, toolchain, art, &chrome)?,
            client_rs: emit_python_client(ir, art)?,
            webhook_rs: String::new(),
            register_rs: emit_python_register(ir)?,
        }),
        Toolchain::Node | Toolchain::Wasm => Ok(EmittedBindings {
            args_rs: with_generated_header(chrome_str(art, &["argsRs"])?, toolchain),
            decisions_rs: emit_decisions(ir, toolchain, art)?,
            payload_builders_rs: emit_payload_builders(ir, toolchain, art, &chrome)?,
            client_rs: emit_client(ir, toolchain, art)?,
            webhook_rs: String::new(),
            register_rs: String::new(),
        }),
        Toolchain::Go => unreachable!("Go is emitted above via the inline chrome"),
        Toolchain::C => unreachable!("C is emitted above via the C chrome snapshot"),
    }
}

// --- decisions.rs ------------------------------------------------------------

fn emit_decisions(ir: &Ir, toolchain: Toolchain, art: &Value) -> GenResult<String> {
    let header = chrome_str(art, &["decisions", "header"])?;
    let trailer = chrome_str(art, &["decisions", "testsTrailer"])?;
    let symbols = symbols_for(ir, IrBindingArtifact::Decisions);

    let mut chunks: Vec<String> = Vec::new();
    let mut prev_section: Option<&str> = None;
    for sym in &symbols {
        maybe_push_section(&mut chunks, &mut prev_section, sym, plain_section);
        chunks.push(emit_sync_fn(sym, toolchain));
    }

    Ok(format!(
        "{}{}\n\n{}",
        with_generated_header(header, toolchain),
        chunks.join("\n\n"),
        trailer
    ))
}

// --- payload_builders.rs -----------------------------------------------------

fn emit_payload_builders(
    ir: &Ir,
    toolchain: Toolchain,
    art: &Value,
    chrome: &Value,
) -> GenResult<String> {
    let header = chrome_str(art, &["payloadBuilders", "header"])?;
    let trailer = chrome_str(art, &["payloadBuilders", "testsTrailer"])?;
    let symbols = symbols_for(ir, IrBindingArtifact::PayloadBuilders);

    match toolchain {
        Toolchain::Node => {
            let helpers = chrome_str(art, &["payloadBuilders", "payloadHelpers"])?;
            let mut chunks: Vec<String> = Vec::new();
            let mut prev_section: Option<&str> = None;
            for sym in &symbols {
                maybe_push_section(&mut chunks, &mut prev_section, sym, plain_section);
                chunks.push(emit_sync_fn(sym, toolchain));
            }
            Ok(format!(
                "{}{}\n\n{}\n\n{}",
                with_generated_header(header, toolchain),
                chunks.join("\n\n"),
                helpers,
                trailer
            ))
        }
        Toolchain::Wasm => {
            let mcp_ids = mcp_symbol_ids(chrome)?;
            let module_header = chrome_str(art, &["payloadBuilders", "mcpPayloadModuleHeader"])?;
            let mcp_helpers = chrome_str(art, &["payloadBuilders", "mcpPayloadHelpers"])?;

            let mut public_chunks: Vec<String> = Vec::new();
            let mut mcp_chunks: Vec<String> = Vec::new();
            let mut prev_section: Option<&str> = None;
            for sym in &symbols {
                if mcp_ids.iter().any(|id| id == &sym.id) {
                    mcp_chunks.push(emit_sync_fn(sym, toolchain));
                } else {
                    maybe_push_section(&mut public_chunks, &mut prev_section, sym, |s| {
                        payload_wasm_section(s)
                    });
                    public_chunks.push(emit_sync_fn(sym, toolchain));
                }
            }

            let mcp_section = payload_wasm_section(MCP_SECTION);
            Ok(format!(
                "{}{}\n\n{}\n\n{}{}\n\n{}\n}}\n\n{}",
                with_generated_header(header, toolchain),
                public_chunks.join("\n\n"),
                mcp_section,
                module_header,
                mcp_chunks.join("\n\n"),
                mcp_helpers,
                trailer
            ))
        }
        Toolchain::Python => {
            let helpers = chrome_str(art, &["payloadBuilders", "payloadHelpers"])?;
            let mut chunks: Vec<String> = Vec::new();
            let mut prev_section: Option<&str> = None;
            for sym in &symbols {
                maybe_push_section(&mut chunks, &mut prev_section, sym, plain_section);
                chunks.push(emit_sync_fn(sym, toolchain));
            }
            Ok(format!(
                "{}{}\n\n{}\n\n{}",
                with_generated_header(header, toolchain),
                chunks.join("\n\n"),
                helpers,
                trailer
            ))
        }
        Toolchain::Ruby => unreachable!("Ruby uses emit_ruby_payload_builders"),
        Toolchain::Go => {
            unreachable!("Go payload builders are emitted via emit_go_payload_builders")
        }
        Toolchain::C => unreachable!("C emits client dispatch only"),
    }
}

fn ruby_header(header: &str) -> String {
    header
        .replace("PyO3", "Magnus")
        .replace("Step 41-b", "Step 44")
        .replace("use pyo3::prelude::*;\n", "")
}

fn emit_ruby_sync_artifact(ir: &Ir, art: &Value, key: &str) -> GenResult<String> {
    let header = ruby_header(chrome_str(art, &[key, "header"])?);
    let trailer = chrome_str(art, &[key, "testsTrailer"])?;
    let artifact = if key == "decisions" {
        IrBindingArtifact::Decisions
    } else {
        IrBindingArtifact::PayloadBuilders
    };
    let mut chunks = Vec::new();
    let mut previous = None;
    for symbol in symbols_for(ir, artifact) {
        maybe_push_section(&mut chunks, &mut previous, symbol, plain_section);
        chunks.push(emit_sync_fn(symbol, Toolchain::Ruby));
    }
    Ok(format!(
        "{}{}\n\n{}",
        with_generated_header(&header, Toolchain::Ruby),
        chunks.join("\n\n"),
        trailer
    ))
}

fn emit_ruby_payload_builders(ir: &Ir, art: &Value) -> GenResult<String> {
    let mut output = emit_ruby_sync_artifact(ir, art, "payloadBuilders")?;
    let helpers = chrome_str(art, &["payloadBuilders", "payloadHelpers"])?;
    let trailer = chrome_str(art, &["payloadBuilders", "testsTrailer"])?;
    output = output.replace(trailer, &format!("{helpers}\n\n{trailer}"));
    Ok(output)
}

// --- native_client.rs / wasm_client.rs ---------------------------------------

fn emit_client(ir: &Ir, toolchain: Toolchain, art: &Value) -> GenResult<String> {
    let header = chrome_str(art, &["client", "header"])?;
    let preamble = chrome_str(art, &["client", "preamble"])?;
    let postamble = chrome_str(art, &["client", "postamble"])?;
    let symbols = symbols_for(ir, IrBindingArtifact::Client);

    let mut chunks: Vec<String> = Vec::new();
    let mut prev_section: Option<&str> = None;
    for sym in &symbols {
        if toolchain == Toolchain::Wasm && is_mcp_composite(sym) {
            continue;
        }
        let is_first = prev_section.is_none();
        if sym.section.as_deref() != prev_section {
            prev_section = sym.section.as_deref();
            // Node suppresses the leading group comment; wasm emits all groups.
            if let Some(section) = sym.section.as_deref() {
                if !(is_first && toolchain == Toolchain::Node) {
                    chunks.push(client_section(section));
                }
            }
        }
        chunks.push(emit_client_method(sym, toolchain)?);
    }

    Ok(format!(
        "{}{}\n{}\n}}\n\n{}",
        with_generated_header(header, toolchain),
        preamble,
        chunks.join("\n\n"),
        postamble
    ))
}

/// Emits the full PyO3 `client.rs` (Groups A–C, async + blocking twins).
///
/// Every client symbol becomes an async `#[pymethods]` fn via
/// `pyo3_async_runtimes::tokio::future_into_py` **plus** a blocking `_blocking`
/// twin (`py.detach` + `runtime::get_runtime().block_on`), reusing the same
/// `run_envelope` plumbing / `client_call_body` as the Node/Wasm emitters.
fn emit_python_client(ir: &Ir, art: &Value) -> GenResult<String> {
    let header = chrome_str(art, &["client", "header"])?;
    let preamble = chrome_str(art, &["client", "preamble"])?;
    let postamble = chrome_str(art, &["client", "postamble"])?;
    let symbols = symbols_for(ir, IrBindingArtifact::Client);

    let mut chunks: Vec<String> = Vec::new();
    let mut prev_section: Option<&str> = None;
    for sym in &symbols {
        maybe_push_section(&mut chunks, &mut prev_section, sym, python_client_section);
        chunks.push(emit_python_client_method(sym)?);
    }

    Ok(format!(
        "{}{}\n{}\n}}\n\n{}",
        with_generated_header(header, Toolchain::Python),
        preamble,
        chunks.join("\n\n"),
        postamble
    ))
}

/// Group-boundary comment inside the `#[pymethods]` impl block.
fn python_client_section(section: &str) -> String {
    format!("// --- {section} ---")
}

/// Emits the full sync-first Magnus `client.rs`.
///
/// Sync-only surface: each method releases the GVL via `without_gvl` while
/// `block_on`-ing the shared tokio runtime. Bodies reuse [`client_call_body`].
fn emit_ruby_client(ir: &Ir, art: &Value) -> GenResult<String> {
    let header = ruby_client_header(chrome_str(art, &["client", "header"])?);
    let preamble = ruby_client_preamble(
        &chrome_str(art, &["client", "preamble"])?
            .replace("SolvaPay::Client", "SolvaPay::Native::Client"),
    );
    let postamble = chrome_str(art, &["client", "postamble"])?;
    let symbols = symbols_for(ir, IrBindingArtifact::Client);

    let mut chunks: Vec<String> = Vec::new();
    let mut prev_section: Option<&str> = None;
    for sym in &symbols {
        maybe_push_section(&mut chunks, &mut prev_section, sym, ruby_client_section);
        chunks.push(emit_ruby_client_method(sym)?);
    }

    Ok(format!(
        "{}{}\n{}\n}}\n\n{}",
        with_generated_header(&header, Toolchain::Ruby),
        preamble,
        chunks.join("\n\n"),
        postamble
    ))
}

fn ruby_client_header(header: &str) -> String {
    let dto_imports = "use solvapay_dto::{\n    ActivatePlanDto, AssignCreditsRequest, AttachBusinessDetailsParams, CancelPurchaseParams,\n    CheckLimitsRequest, CloneProductOverrides, ConfigureMcpPlansDto, CreateCheckoutSessionRequest,\n    CreateCustomerRequest, CreateCustomerSessionRequest, CreatePaymentIntentParams,\n    CreatePlanParams, CreateProductRequest, CreateTopupPaymentIntentParams,\n    DisableAutoRechargeParams, GetAutoRechargeParams, GetCustomerBalanceParams, GetCustomerParams,\n    GetPaymentMethodParams, GetUserInfoParams, McpBootstrapDto, ProcessPaymentIntentParams,\n    ReactivatePurchaseParams, SaveAutoRechargeParams, TrackUsageBulkRequest, TrackUsageRequest,\n    UpdateCustomerParams, UpdatePlanRequest, UpdateProductRequest,\n};\n";
    header
        .replace(
            "Magnus [`SolvaPayClient`] — Step 43 hello-world scaffold (`getMerchant`).",
            "Magnus private [`SolvaPayClient`] — full Groups A–C surface (Step 44).",
        )
        .replace("SolvaPay::Client", "SolvaPay::Native::Client")
        .replace(
            "use solvapay_core::SdkError;\n",
            &format!("use solvapay_core::SdkError;\n{dto_imports}"),
        )
        .replace(
            "ClientShell, ReqwestTransport, SharedTransport, SolvaPayClient as CoreClient,",
            "mulberry32, ClientShell, ReqwestTransport, SharedTransport, SolvaPayClient as CoreClient,",
        )
}

fn ruby_client_preamble(preamble: &str) -> String {
    let old_builder = "    let transport = ReqwestTransport::new()?;\n    let transport: SharedTransport = Arc::new(transport);\n    let mut shell = ClientShell::new(transport, api_key);\n    if let Some(base) = api_base_url {\n        shell = shell.with_base_url(base);\n    }\n    Ok(Arc::new(CoreClient::new(shell)))";
    let new_builder = "    build_solvapay_client_with_hooks(api_key, api_base_url, None, None)";
    let hook_builder = "}\n\n/// Builds a client with deterministic fixture clock and RNG hooks.\npub(crate) fn build_solvapay_client_with_hooks(\n    api_key: String,\n    api_base_url: Option<String>,\n    clock_unix_ms: Option<u64>,\n    rng_seed: Option<u32>,\n) -> std::result::Result<Arc<CoreClient>, SdkError> {\n    let transport = ReqwestTransport::new()?;\n    let transport: SharedTransport = Arc::new(transport);\n    let mut shell = ClientShell::new(transport, api_key);\n    if let Some(base) = api_base_url {\n        shell = shell.with_base_url(base);\n    }\n    if let Some(ms) = clock_unix_ms {\n        shell = shell.with_clock(Arc::new(move || ms));\n    }\n    if let Some(seed) = rng_seed {\n        shell = shell.with_rng(Arc::new(mulberry32(seed)));\n    }\n    Ok(Arc::new(CoreClient::new(shell)))\n}\n\n/// Magnus client";
    let fixture_constructor = "\n    /// Test-only constructor for shared golden fixture replay.\n    pub(crate) fn for_fixtures(ruby: &Ruby, args: &[Value]) -> Result<Self, Error> {\n        let _ = ruby;\n        let args = scan_args::<(String, String), (Option<u64>, Option<u32>), (), (), (), ()>(args)?;\n        let (api_key, api_base_url) = args.required;\n        let (clock_unix_ms, rng_seed) = args.optional;\n        build_solvapay_client_with_hooks(\n            api_key,\n            Some(api_base_url),\n            clock_unix_ms,\n            rng_seed,\n        )\n        .map(|client| Self { client })\n        .map_err(sdk_error_to_magnus)\n    }\n\n";
    preamble
        .replace(old_builder, new_builder)
        .replace("}\n\n/// Magnus client", hook_builder)
        + fixture_constructor
}

/// Group-boundary comment inside the Magnus `impl` block.
fn ruby_client_section(section: &str) -> String {
    format!("// --- {section} ---")
}

// --- Go (wazero WASI guest) --------------------------------------------------

/// `args.rs` chrome: shared deserialize structs + `split_path_refs` helper.
///
/// Per-operation ClientAwait/ClientSplit bodies deserialize into `solvapay_dto`
/// types in `client.rs` (same convention as the Python/Ruby guest shims).
const GO_ARGS_RS: &str = r#"//! Shared JSON-args helpers for the WASI guest shims (Step 50).

use serde::Deserialize;
use serde::Serialize;
use serde_json::{Map, Value};
use solvapay_core::{HelperErrorResult, SdkError};

use crate::error::parse_args_json;

/// `sv_client_new` config payload: `{"apiKey":…,"apiBaseUrl":…}`.
#[derive(Debug, Deserialize)]
pub(crate) struct ClientConfig {
    /// Bearer token forwarded to the client shell.
    #[serde(rename = "apiKey")]
    pub(crate) api_key: String,
    /// Optional origin override (defaults to `https://api.solvapay.com`).
    #[serde(rename = "apiBaseUrl")]
    pub(crate) api_base_url: Option<String>,
}

/// `sv_verify_webhook` args: `{"body","signature","secret","nowUnixSecs"}`.
#[derive(Debug, Deserialize)]
pub(crate) struct VerifyWebhookArgs {
    /// Raw request body string (must match the signed bytes).
    pub(crate) body: String,
    /// `SV-Signature` header value (`t=…,v1=…`).
    pub(crate) signature: String,
    /// Webhook secret including the `whsec_` prefix.
    pub(crate) secret: String,
    /// Host clock as unix seconds.
    #[serde(rename = "nowUnixSecs")]
    pub(crate) now_unix_secs: i64,
}

/// Extracts path refs from a combined args object, leaving the remaining body.
///
/// Keys are removed in order; missing/non-string keys map to Transport errors.
pub(crate) fn split_path_refs(
    args_json: &str,
    keys: &[&str],
) -> Result<(Vec<String>, Value), SdkError> {
    let mut map: Map<String, Value> = parse_args_json(args_json)?;
    let mut refs = Vec::with_capacity(keys.len());
    for key in keys {
        let value = map
            .remove(*key)
            .and_then(|v| v.as_str().map(str::to_owned))
            .ok_or_else(|| SdkError::transport(format!("missing {key}"), false))?;
        refs.push(value);
    }
    Ok((refs, Value::Object(map)))
}

/// Parses args JSON into an object map.
pub(crate) fn args_map(args_json: &str) -> Result<Map<String, Value>, SdkError> {
    parse_args_json(args_json)
}

/// Serializes `value` to JSON, mapping failures to Transport.
pub(crate) fn to_value<T: Serialize>(value: &T) -> Result<Value, SdkError> {
    serde_json::to_value(value)
        .map_err(|err| SdkError::transport(format!("serialize failed: {err}"), false))
}

/// `Option<HelperErrorResult>` → `null` or serialized error (fixture parity).
pub(crate) fn option_helper_err(
    opt: Option<HelperErrorResult>,
) -> Result<Value, SdkError> {
    match opt {
        None => Ok(Value::Null),
        Some(err) => to_value(&err),
    }
}

/// `Result<T, HelperErrorResult>` → Ok or Err as the envelope **value**.
pub(crate) fn result_as_value<T: Serialize>(
    result: Result<T, HelperErrorResult>,
) -> Result<Value, SdkError> {
    match result {
        Ok(value) => to_value(&value),
        Err(err) => to_value(&err),
    }
}

/// Reads a required string arg.
pub(crate) fn require_string(args: &Map<String, Value>, key: &str) -> Result<String, SdkError> {
    match args.get(key) {
        Some(Value::String(s)) => Ok(s.clone()),
        Some(_) => Err(SdkError::transport(
            format!("args.{key} must be a string"),
            false,
        )),
        None => Err(SdkError::transport(
            format!("args.{key} is required"),
            false,
        )),
    }
}

/// Reads an optional string arg (`null`/absent → `None`).
pub(crate) fn optional_string(
    args: &Map<String, Value>,
    key: &str,
) -> Result<Option<String>, SdkError> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => Ok(Some(s.clone())),
        Some(_) => Err(SdkError::transport(
            format!("args.{key} must be a string or null"),
            false,
        )),
    }
}

/// Reads a required boolean arg.
pub(crate) fn require_bool(args: &Map<String, Value>, key: &str) -> Result<bool, SdkError> {
    match args.get(key) {
        Some(Value::Bool(b)) => Ok(*b),
        Some(_) => Err(SdkError::transport(
            format!("args.{key} must be a boolean"),
            false,
        )),
        None => Err(SdkError::transport(
            format!("args.{key} is required"),
            false,
        )),
    }
}

/// Reads a required f64 arg.
pub(crate) fn require_f64(args: &Map<String, Value>, key: &str) -> Result<f64, SdkError> {
    match args.get(key) {
        Some(Value::Number(n)) => n.as_f64().ok_or_else(|| {
            SdkError::transport(format!("args.{key} must be a finite number"), false)
        }),
        Some(_) => Err(SdkError::transport(
            format!("args.{key} must be a number"),
            false,
        )),
        None => Err(SdkError::transport(
            format!("args.{key} is required"),
            false,
        )),
    }
}

/// Reads an optional f64 arg (`null`/absent → `None`).
pub(crate) fn optional_f64(args: &Map<String, Value>, key: &str) -> Result<Option<f64>, SdkError> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(n)) => n.as_f64().map(Some).ok_or_else(|| {
            SdkError::transport(format!("args.{key} must be a finite number"), false)
        }),
        Some(_) => Err(SdkError::transport(
            format!("args.{key} must be a number or null"),
            false,
        )),
    }
}

/// Reads a required i64 arg.
pub(crate) fn require_i64(args: &Map<String, Value>, key: &str) -> Result<i64, SdkError> {
    match args.get(key) {
        Some(Value::Number(n)) => n
            .as_i64()
            .ok_or_else(|| SdkError::transport(format!("args.{key} must be an integer"), false)),
        Some(_) => Err(SdkError::transport(
            format!("args.{key} must be a number"),
            false,
        )),
        None => Err(SdkError::transport(
            format!("args.{key} is required"),
            false,
        )),
    }
}

/// Reads a required u32 arg.
pub(crate) fn require_u32(args: &Map<String, Value>, key: &str) -> Result<u32, SdkError> {
    match args.get(key) {
        Some(Value::Number(n)) => n
            .as_u64()
            .and_then(|v| u32::try_from(v).ok())
            .ok_or_else(|| SdkError::transport(format!("args.{key} must be a u32"), false)),
        Some(_) => Err(SdkError::transport(
            format!("args.{key} must be a number"),
            false,
        )),
        None => Err(SdkError::transport(
            format!("args.{key} is required"),
            false,
        )),
    }
}

/// Reads an optional u32 arg (`null`/absent → `None`).
pub(crate) fn optional_u32(args: &Map<String, Value>, key: &str) -> Result<Option<u32>, SdkError> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(n)) => n
            .as_u64()
            .and_then(|v| u32::try_from(v).ok())
            .map(Some)
            .ok_or_else(|| SdkError::transport(format!("args.{key} must be a u32"), false)),
        Some(_) => Err(SdkError::transport(
            format!("args.{key} must be a number or null"),
            false,
        )),
    }
}

/// Reads an optional u64 arg (`null`/absent → `None`).
pub(crate) fn optional_u64(args: &Map<String, Value>, key: &str) -> Result<Option<u64>, SdkError> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(n)) => n
            .as_u64()
            .map(Some)
            .ok_or_else(|| SdkError::transport(format!("args.{key} must be a u64"), false)),
        Some(_) => Err(SdkError::transport(
            format!("args.{key} must be a number or null"),
            false,
        )),
    }
}

/// Reads an optional u16 arg (`null`/absent → `None`).
pub(crate) fn optional_u16(args: &Map<String, Value>, key: &str) -> Result<Option<u16>, SdkError> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(n)) => n
            .as_u64()
            .and_then(|v| u16::try_from(v).ok())
            .map(Some)
            .ok_or_else(|| SdkError::transport(format!("args.{key} must be a u16"), false)),
        Some(_) => Err(SdkError::transport(
            format!("args.{key} must be a number or null"),
            false,
        )),
    }
}

/// Reads a required object arg as a map reference.
pub(crate) fn require_object<'a>(
    args: &'a Map<String, Value>,
    key: &str,
) -> Result<&'a Map<String, Value>, SdkError> {
    match args.get(key) {
        Some(Value::Object(map)) => Ok(map),
        Some(_) | None => Err(SdkError::transport(
            format!("args.{key} must be an object"),
            false,
        )),
    }
}

/// Reads a required array arg.
pub(crate) fn require_array<'a>(
    args: &'a Map<String, Value>,
    key: &str,
) -> Result<&'a [Value], SdkError> {
    match args.get(key) {
        Some(Value::Array(arr)) => Ok(arr.as_slice()),
        Some(_) | None => Err(SdkError::transport(
            format!("args.{key} must be an array"),
            false,
        )),
    }
}

/// Optional raw JSON value (`null`/absent → `None`).
pub(crate) fn optional_value(args: &Map<String, Value>, key: &str) -> Option<Value> {
    match args.get(key) {
        None | Some(Value::Null) => None,
        Some(value) => Some(value.clone()),
    }
}

/// Deserializes a required typed arg.
pub(crate) fn require_typed<T: serde::de::DeserializeOwned>(
    args: &Map<String, Value>,
    key: &str,
) -> Result<T, SdkError> {
    let value = args
        .get(key)
        .ok_or_else(|| SdkError::transport(format!("args.{key} is required"), false))?;
    serde_json::from_value(value.clone())
        .map_err(|err| SdkError::transport(format!("invalid args.{key}: {err}"), false))
}

/// Deserializes an optional typed arg (`null`/absent → `None`).
pub(crate) fn optional_typed<T: serde::de::DeserializeOwned>(
    args: &Map<String, Value>,
    key: &str,
) -> Result<Option<T>, SdkError> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => serde_json::from_value(value.clone())
            .map(Some)
            .map_err(|err| SdkError::transport(format!("invalid args.{key}: {err}"), false)),
    }
}
"#;

/// Emits Go guest `args.rs` (config/webhook structs + `split_path_refs`).
fn emit_go_args() -> String {
    with_generated_header(GO_ARGS_RS, Toolchain::Go)
}

/// `client.rs` chrome: module doc + fixed imports (DTO imports are appended).
const GO_CLIENT_HEADER_PREFIX: &str = r#"//! WASI guest client shims — full Groups A–C surface (Step 50).
//!
//! Each export takes a guest pointer/length pair addressing a UTF-8 JSON args
//! string and returns a packed `(ptr<<32)|len` handle to a JSON envelope
//! string (`{"ok":true,"value":…}` | `{"ok":false,"error":…}`).

use std::cell::RefCell;
use std::rc::Rc;
use std::sync::Arc;

use solvapay_core::SdkError;
"#;

const GO_CLIENT_HEADER_SUFFIX: &str = r#"
use solvapay_transport::{ClientShell, SharedTransport, SolvaPayClient as CoreClient};

use crate::abi::{pack, read_string};
use crate::args::{split_path_refs, ClientConfig};
use crate::error::{internal_error_envelope, parse_args_json, run_envelope, run_envelope_sync};
use crate::host_transport::WasiHostTransport;
"#;

/// `client.rs` chrome: thread-local client + `sv_client_new` + `with_client`.
const GO_CLIENT_PREAMBLE: &str = r#"thread_local! {
    /// Guest-global client configured by `sv_client_new` (single-threaded WASI).
    static CLIENT: RefCell<Option<Rc<CoreClient>>> = const { RefCell::new(None) };
}

/// Configures the thread-local client from `{"apiKey":…,"apiBaseUrl":…}`.
///
/// # Safety
///
/// `args_ptr` / `args_len` must describe a valid guest allocation from `sv_alloc`.
#[no_mangle]
pub unsafe extern "C" fn sv_client_new(args_ptr: *mut u8, args_len: usize) -> u64 {
    let args_json = read_string(args_ptr, args_len);
    pack(run_envelope_sync(|| {
        let config: ClientConfig = parse_args_json(&args_json)?;
        let transport: SharedTransport = Arc::new(WasiHostTransport::new());
        let mut shell = ClientShell::new(transport, config.api_key);
        if let Some(base) = config.api_base_url {
            shell = shell.with_base_url(base);
        }
        CLIENT.with(|cell| *cell.borrow_mut() = Some(Rc::new(CoreClient::new(shell))));
        Ok(serde_json::Value::Bool(true))
    }))
}

/// Runs `f` with the configured client, or an internal-error envelope if unset.
fn with_client<F: FnOnce(Rc<CoreClient>) -> String>(f: F) -> String {
    match CLIENT.with(|cell| cell.borrow().clone()) {
        Some(client) => f(client),
        None => internal_error_envelope("client not configured: call sv_client_new first"),
    }
}
"#;

/// `webhook.rs` chrome: the full sync `sv_verify_webhook` guest export.
const GO_WEBHOOK_RS: &str = r#"//! WASI guest webhook shim (`verifyWebhook`).
//!
//! Synchronous: verifies the HMAC signature in-guest and returns the parsed
//! JSON body as an envelope. Failures fold into `SdkError::Webhook`, carrying
//! the stable snake_case `code` for host-side `errors.As` matching.

use solvapay_core::{verify_webhook as core_verify_webhook, SdkError};

use crate::abi::{pack, read_string};
use crate::args::VerifyWebhookArgs;
use crate::error::{parse_args_json, run_envelope_sync};

/// Verifies a SolvaPay webhook signature and returns the parsed JSON body.
///
/// Args JSON: `{"body","signature","secret","nowUnixSecs"}`.
///
/// # Safety
///
/// `args_ptr` / `args_len` must describe a valid guest allocation from `sv_alloc`.
#[no_mangle]
pub unsafe extern "C" fn sv_verify_webhook(args_ptr: *mut u8, args_len: usize) -> u64 {
    let args_json = read_string(args_ptr, args_len);
    pack(run_envelope_sync(|| {
        let args: VerifyWebhookArgs = parse_args_json(&args_json)?;
        core_verify_webhook(&args.body, &args.signature, &args.secret, args.now_unix_secs)
            .map_err(SdkError::from)
    }))
}
"#;

/// Emits the Go guest `client.rs` (full Groups A–C surface).
fn emit_go_client(ir: &Ir) -> GenResult<String> {
    let symbols = symbols_for(ir, IrBindingArtifact::Client);
    let mut dto_types: Vec<String> = symbols
        .iter()
        .filter_map(|sym| sym.dto_type.as_deref().and_then(solvapay_dto_import_ident))
        .map(str::to_owned)
        .collect();
    dto_types.sort();
    dto_types.dedup();

    let dto_import = if dto_types.is_empty() {
        String::new()
    } else {
        format!(
            "use solvapay_dto::{{\n    {},\n}};\n",
            dto_types.join(",\n    ")
        )
    };

    let header = format!("{GO_CLIENT_HEADER_PREFIX}{dto_import}{GO_CLIENT_HEADER_SUFFIX}");

    let mut chunks: Vec<String> = Vec::new();
    for sym in &symbols {
        chunks.push(emit_go_client_method(sym)?);
    }

    Ok(format!(
        "{}{}\n{}",
        with_generated_header(&header, Toolchain::Go),
        GO_CLIENT_PREAMBLE,
        chunks.join("\n\n")
    ))
}

/// Emits one `#[no_mangle] extern "C"` guest export for a client symbol.
///
/// Supports `clientIgnore` / `clientAwait` / `clientSplit`, driven by the same
/// [`client_call_body`] expression as the other toolchains, wrapped in
/// `pollster::block_on` for the single-threaded WASI guest.
fn emit_go_client_method(sym: &IrBindingSymbol) -> GenResult<String> {
    let doc = render_doc(&sym.doc);
    let fn_name = &sym.rust_fn_name;
    let (param, inner) = client_call_body(sym)?;
    let inner = strip_envelope_await(&inner, &sym.id)?;
    let call = format!("pollster::block_on({inner})");
    let args_line = if param == "_args_json" {
        "let _args_json = read_string(args_ptr, args_len);"
    } else {
        "let args_json = read_string(args_ptr, args_len);"
    };

    Ok(format!(
        "{doc}\n///\n/// # Safety\n///\n/// `args_ptr` / `args_len` must describe a valid guest allocation from `sv_alloc`.\n#[no_mangle]\npub unsafe extern \"C\" fn sv_{fn_name}(args_ptr: *mut u8, args_len: usize) -> u64 {{\n    {args_line}\n    pack(with_client(|client| {{\n        {call}\n    }}))\n}}"
    ))
}

/// Emits the Go guest `webhook.rs` (static `sv_verify_webhook` shim).
fn emit_go_webhook() -> String {
    with_generated_header(GO_WEBHOOK_RS, Toolchain::Go)
}

const GO_DECISIONS_HEADER: &str = r#"//! WASI guest decision / paywall / retry shims.

use serde_json::Value;
use solvapay_core::{
    assert_valid_product_ref, attach_business_details_validation_error,
    build_create_customer_params, build_gate_message, build_nudge_message, build_paywall_gate,
    classify_cancel_error, classify_create_error, classify_customer_ref, classify_lookup_error,
    classify_paywall_state, classify_reactivate_error, coerce_customer_options,
    decide_paywall_outcome, evaluate_cached_limits, evaluate_fresh_limits,
    evaluate_product_readiness, extract_backend_customer_ref, is_cached_customer_ref_valid,
    is_email_conflict, is_error_result, map_route_error, normalize_cancel_response,
    normalize_reactivate_response, paywall_client_payload, project_payment_intent_result,
    billing_cycle, charges, credits_per_unit_from_balance, headline_charges,
    counts_usage, included_units, meter_name, pegged_credits_per_unit, per_unit_charge,
    project_topup_process_outcome, project_usage_snapshot, require_product_ref,
    trial_days,
    resolve_check_limits_params, resolve_fallback_gate_limits, resolve_product_ref,
    resolve_purchase_customer_ref, resolve_return_url, select_active_purchases,
    validate_activate_plan_params, validate_attach_business_details_params,
    validate_checkout_session_params, validate_create_payment_intent_params,
    validate_get_product_params, validate_list_plans_params,
    validate_process_payment_intent_params, validate_purchase_ref,
    validate_topup_payment_intent_params, Backoff, GateContent, PaymentIntentSource, PaywallGate,
    PaywallGateLimits, PaywallLimits, PaywallState, ProductReadinessInput, RetryPolicy,
    RouteErrorInput, RouteErrorKind, SdkError, DEFAULT_INITIAL_DELAY_MS, DEFAULT_MAX_RETRIES,
};

use crate::abi::{pack, read_string};
use crate::args::{
    args_map, option_helper_err, optional_f64, optional_string, optional_typed, optional_u16,
    optional_u32, optional_u64, optional_value, require_array, require_bool, require_f64,
    require_i64, require_object, require_string, require_typed, require_u32, result_as_value,
    to_value,
};
use crate::error::run_envelope_sync;
"#;

const GO_PAYLOAD_HEADER: &str = r#"//! WASI guest payload-builder shims.

use serde_json::{Map, Value};
use solvapay_core::{
    assert_response_result, build_prompt_descriptor_metadata, build_prompt_user_message,
    build_tool_descriptor_metadata, credits_to_display_minor_units, derive_icons,
    derive_tax_id_type, get_business_country_options, get_seller_tax_identifier_display_label,
    get_tax_id_example, get_tax_id_field_label, get_tax_id_helper_text, is_zero_decimal_currency,
    build_payable_tool_result, make_response_result, mcp_tool_names_json, mcp_view_maps,
    minor_units_per_major, paywall_tool_result, resolve_seller_identity_display,
    resolve_tax_behavior,
    seller_tax_identifier_display_label_by_type, validate_business_details,
    validate_public_base_url, BuildPromptDescriptorMetadataOptions,
    BuildToolDescriptorMetadataOptions, BusinessDetailsInput, CreditsToDisplayInput,
    MerchantBranding, PaywallGate, ResponseEnvelope, SdkError, SellerIdentityInput,
};

use crate::abi::{pack, read_string};
use crate::args::{
    args_map, optional_string, require_f64, require_string, require_typed, to_value,
};
use crate::error::run_envelope_sync;
"#;

const GO_PAYLOAD_HELPERS: &str = r#"fn optional_views(args: &Map<String, Value>) -> Result<Option<Vec<String>>, SdkError> {
    match args.get("views") {
        None => Ok(None),
        Some(Value::Array(items)) => {
            let mut views = Vec::with_capacity(items.len());
            for item in items {
                match item.as_str() {
                    Some(s) => views.push(s.to_owned()),
                    None => {
                        return Err(SdkError::transport(
                            "args.views must be an array of strings".to_owned(),
                            false,
                        ));
                    }
                }
            }
            Ok(Some(views))
        }
        Some(_) => Err(SdkError::transport(
            "args.views must be an array when present".to_owned(),
            false,
        )),
    }
}

fn optional_branding(args: &Map<String, Value>) -> Result<Option<MerchantBranding>, SdkError> {
    match args.get("branding") {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Object(map)) => Ok(Some(MerchantBranding {
            brand_name: optional_string_field(map, "brandName")?,
            icon_url: optional_string_field(map, "iconUrl")?,
            logo_url: optional_string_field(map, "logoUrl")?,
        })),
        Some(_) => Err(SdkError::transport(
            "args.branding must be an object when present".to_owned(),
            false,
        )),
    }
}

fn optional_string_field(map: &Map<String, Value>, key: &str) -> Result<Option<String>, SdkError> {
    match map.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => Ok(Some(s.clone())),
        Some(_) => Err(SdkError::transport(
            format!("args.branding.{key} must be a string when present"),
            false,
        )),
    }
}
"#;

fn emit_go_decisions(ir: &Ir) -> GenResult<String> {
    Ok(emit_go_sync_artifact(
        ir,
        IrBindingArtifact::Decisions,
        GO_DECISIONS_HEADER,
        "",
    ))
}

fn emit_go_payload_builders(ir: &Ir) -> GenResult<String> {
    Ok(emit_go_sync_artifact(
        ir,
        IrBindingArtifact::PayloadBuilders,
        GO_PAYLOAD_HEADER,
        GO_PAYLOAD_HELPERS,
    ))
}

fn emit_go_sync_artifact(
    ir: &Ir,
    artifact: IrBindingArtifact,
    header: &str,
    helpers: &str,
) -> String {
    let symbols = symbols_for(ir, artifact);
    let mut chunks: Vec<String> = Vec::new();
    let mut prev_section: Option<&str> = None;
    for sym in &symbols {
        maybe_push_section(&mut chunks, &mut prev_section, sym, plain_section);
        chunks.push(emit_go_sync_fn(sym));
    }
    let helper_block = if helpers.is_empty() {
        String::new()
    } else {
        format!("\n\n{helpers}")
    };
    format!(
        "{}{}{helper_block}",
        with_generated_header(header, Toolchain::Go),
        chunks.join("\n\n"),
    )
}

fn emit_go_sync_fn(sym: &IrBindingSymbol) -> String {
    let doc = render_doc(pick_doc(sym, Toolchain::Go));
    let fn_name = &sym.rust_fn_name;
    let body = sync_body(sym, Toolchain::Go);
    let doc_prefix = if doc.is_empty() {
        String::new()
    } else {
        format!("{doc}\n")
    };
    format!(
        "{doc_prefix}///\n/// # Safety\n///\n/// `args_ptr` / `args_len` must describe a valid guest allocation from `sv_alloc`.\n#[no_mangle]\npub unsafe extern \"C\" fn sv_{fn_name}(args_ptr: *mut u8, args_len: usize) -> u64 {{\n    let args_json = read_string(args_ptr, args_len);\n    pack(run_envelope_sync(|| {{\n{body}\n    }}))\n}}"
    )
}

/// Strips the trailing `.await` from a [`client_call_body`] expression so a
/// binding can drive the future with `block_on`.
fn strip_envelope_await<'a>(inner: &'a str, id: &str) -> GenResult<&'a str> {
    inner
        .strip_suffix(".await")
        .map(str::trim_end)
        .ok_or_else(|| GenError::Parse(format!("{id} expected client_call_body to end in .await")))
}

/// Emits the C ABI `dispatch.rs` match table (full Groups A–C surface).
fn emit_c_client(ir: &Ir) -> GenResult<String> {
    let chrome: Value = serde_json::from_str(C_SNAPSHOT)
        .map_err(|e| GenError::Parse(format!("invalid c-emit snapshot: {e}")))?;
    let symbols = symbols_for(ir, IrBindingArtifact::Client);
    let mut dto_types: Vec<String> = symbols
        .iter()
        .filter_map(|sym| sym.dto_type.as_deref().and_then(solvapay_dto_import_ident))
        .map(str::to_owned)
        .collect();
    dto_types.sort();
    dto_types.dedup();

    let dto_import = if dto_types.is_empty() {
        String::new()
    } else {
        format!(
            "use solvapay_dto::{{\n    {},\n}};\n",
            dto_types.join(",\n    ")
        )
    };

    let header = chrome_str(&chrome, &["header"])?;
    let uses_prefix = chrome_str(&chrome, &["usesPrefix"])?;
    let uses_suffix = chrome_str(&chrome, &["usesSuffix"])?;
    let split = chrome_str(&chrome, &["splitPathRefs"])?;
    let dispatch_open = chrome_str(&chrome, &["dispatchOpen"])?;
    let postamble = chrome_str(&chrome, &["postamble"])?;
    let tests = chrome_str(&chrome, &["testsTrailer"])?;

    let mut arms: Vec<String> = Vec::new();
    for sym in &symbols {
        arms.push(emit_c_match_arm(sym)?);
    }

    Ok(format!(
        "{}{}{}{}\n{}\n{}{}\n{}\n{}",
        with_generated_header(header, Toolchain::C),
        uses_prefix,
        dto_import,
        uses_suffix,
        split,
        dispatch_open,
        arms.join("\n"),
        postamble,
        tests
    ))
}

/// One C `match op` arm: same [`client_call_body`] as other toolchains, driven
/// with `runtime::runtime().block_on` instead of `.await` on the envelope.
fn emit_c_match_arm(sym: &IrBindingSymbol) -> GenResult<String> {
    let (_param, inner) = client_call_body(sym)?;
    let inner = strip_envelope_await(&inner, &sym.id)?;
    Ok(format!(
        "        \"{}\" => runtime::runtime().block_on({inner}),",
        sym.id
    ))
}

/// Emits a sync GVL-releasing Magnus client method for one symbol.
fn emit_ruby_client_method(sym: &IrBindingSymbol) -> GenResult<String> {
    let doc = render_doc(&sym.doc);
    let fn_name = &sym.names.rb;
    let (param, inner) = client_call_body(sym)?;
    let discard = if param == "_args_json" {
        "\n    let _ = args_json;"
    } else {
        ""
    };

    Ok(format!(
        "{doc}\npub(crate) fn {fn_name}(&self, args_json: String) -> String {{{discard}\n    let client = Arc::clone(&self.client);\n    without_gvl(|| {{\n        runtime::get_runtime().block_on(async move {{ {inner} }})\n    }})\n}}"
    ))
}

/// Emits async `future_into_py` + blocking interpreter-detached twin for one
/// client symbol, reusing the shared [`client_call_body`] expression.
fn emit_python_client_method(sym: &IrBindingSymbol) -> GenResult<String> {
    let doc = render_doc(&sym.doc);
    let fn_name = &sym.rust_fn_name;
    let py_name = &sym.names.py;
    let blocking_name = format!("{py_name}_blocking");
    let (param, inner) = client_call_body(sym)?;
    let discard = if param == "_args_json" {
        "\n    let _ = args_json;"
    } else {
        ""
    };
    let name_attr = if fn_name == py_name {
        String::new()
    } else {
        format!("\n#[pyo3(name = \"{py_name}\")]")
    };

    // Single per-symbol body drives both surfaces (async future_into_py +
    // blocking py.detach / block_on twin).
    let async_fn = format!(
        "{doc}{name_attr}\nfn {fn_name}<'py>(&self, py: Python<'py>, args_json: String) -> PyResult<Bound<'py, PyAny>> {{{discard}\n    let client = Arc::clone(&self.client);\n    pyo3_async_runtimes::tokio::future_into_py(py, async move {{\n        Ok::<_, PyErr>({inner})\n    }})\n}}"
    );
    let blocking_doc =
        format!("/// Blocking twin of [`Self::{fn_name}`] (interpreter detached while awaiting).");
    let blocking_fn = format!(
        "{blocking_doc}\n#[pyo3(name = \"{blocking_name}\")]\nfn {blocking_name}(&self, py: Python<'_>, args_json: String) -> String {{{discard}\n    let client = Arc::clone(&self.client);\n    py.detach(|| {{\n        runtime::get_runtime().block_on(async move {{ {inner} }})\n    }})\n}}"
    );
    Ok(format!("{async_fn}\n\n{blocking_fn}"))
}

fn emit_client_method(sym: &IrBindingSymbol, toolchain: Toolchain) -> GenResult<String> {
    let doc = render_doc(&sym.doc);
    let attr = attr_macro(toolchain, &sym.id);
    let clone = clone_ty(toolchain);
    let fn_name = &sym.rust_fn_name;
    let (param, inner) = client_call_body(sym)?;

    Ok(format!(
        "{doc}\n{attr}\npub async fn {fn_name}(&self, {param}: String) -> String {{\n    let client = {clone}::clone(&self.client);\n    {inner}\n}}"
    ))
}

/// Shared per-symbol client body: returns the `args_json` param name (`_args_json`
/// for arg-ignoring methods) and the `run_envelope(async move { … }).await`
/// expression. Toolchain-agnostic — Node/Wasm wrap it in an `async fn`, Python
/// wraps it in `future_into_py` + a blocking `block_on` twin, Ruby wraps it in
/// `without_gvl` + `block_on`.
fn client_call_body(sym: &IrBindingSymbol) -> GenResult<(&'static str, String)> {
    let core = core_call(sym)?;

    let serialize = match &sym.call {
        IrBindingCall::Wrap { serialize, .. } => *serialize,
        IrBindingCall::Verbatim => {
            return Err(GenError::Parse(format!(
                "client symbol {} unexpectedly verbatim",
                sym.id
            )))
        }
    };

    let out = match serialize {
        IrSerializeKind::ClientIgnore => (
            "_args_json",
            format!("run_envelope(async move {{ client.{core}().await }}).await"),
        ),
        IrSerializeKind::ClientAwait => {
            let dto = sym.dto_type.as_deref().ok_or_else(|| {
                GenError::Parse(format!("client {} clientAwait missing dtoType", sym.id))
            })?;
            (
                "args_json",
                format!(
                    "run_envelope(async move {{\n            let params: {dto} = parse_args_json(&args_json)?;\n            client.{core}(params).await\n        }})\n        .await"
                ),
            )
        }
        IrSerializeKind::ClientSplit => {
            let keys = sym
                .split_path_refs
                .iter()
                .map(|k| format!("\"{k}\""))
                .collect::<Vec<_>>()
                .join(", ");
            let call_args = sym.client_call_args.join(", ");
            let body = match &sym.dto_type {
                Some(dto) => {
                    let body_local = body_local_name(sym);
                    format!(
                        "run_envelope(async move {{\n            let (refs, body) = split_path_refs(&args_json, &[{keys}])?;\n            let {body_local}: {dto} = serde_json::from_value(body).map_err(|err| {{\n                SdkError::transport(format!(\"invalid {id} body: {{err}}\"), false)\n            }})?;\n            client.{core}({call_args}).await\n        }})\n        .await",
                        id = sym.id
                    )
                }
                None => format!(
                    "run_envelope(async move {{\n            let (refs, _) = split_path_refs(&args_json, &[{keys}])?;\n            client.{core}({call_args}).await\n        }})\n        .await"
                ),
            };
            ("args_json", body)
        }
        other => {
            return Err(GenError::Parse(format!(
                "client symbol {} has non-client serialize {other:?}",
                sym.id
            )))
        }
    };

    Ok(out)
}

// --- shared sync fn body -----------------------------------------------------

fn emit_sync_fn(sym: &IrBindingSymbol, toolchain: Toolchain) -> String {
    let doc = render_doc(pick_doc(sym, toolchain));
    let export_name = match toolchain {
        Toolchain::Python => sym.names.py.as_str(),
        Toolchain::Ruby => sym.names.rb.as_str(),
        Toolchain::Node | Toolchain::Wasm | Toolchain::Go | Toolchain::C => sym.id.as_str(),
    };
    let attr = attr_macro(toolchain, export_name);
    let attr_line = if attr.is_empty() {
        String::new()
    } else {
        format!("{attr}\n")
    };
    let fn_name = &sym.rust_fn_name;
    let body = sync_body(sym, toolchain);
    format!(
        "{doc}\n{attr_line}pub fn {fn_name}(args_json: String) -> String {{\n    run_envelope_sync(|| {{\n{body}\n    }})\n}}"
    )
}

/// Emits Python `register.rs` — wires every sync `#[pyfunction]` into `_solvapay`.
fn emit_python_register(ir: &Ir) -> GenResult<String> {
    let mut imports: Vec<String> = Vec::new();
    let mut registrations: Vec<String> = Vec::new();

    for (module, artifact) in [
        ("decisions", IrBindingArtifact::Decisions),
        ("payload_builders", IrBindingArtifact::PayloadBuilders),
    ] {
        let symbols = symbols_for(ir, artifact);
        for sym in symbols {
            let fn_name = &sym.rust_fn_name;
            imports.push(format!("use crate::{module}::{fn_name};"));
            registrations.push(format!(
                "    m.add_function(wrap_pyfunction!({fn_name}, m)?)?;"
            ));
        }
    }

    let header = generated_header(
        crate::header::CommentStyle::ModuleDoc,
        "python-bindings-out",
    );
    Ok(format!(
        "{header}//! Registers generated sync PyO3 free functions on `_solvapay` (Step 41-b).\n\nuse pyo3::prelude::*;\nuse pyo3::wrap_pyfunction;\n\n{}\n\n/// Adds every generated decision + payload-builder `#[pyfunction]` to `m`.\n///\n/// # Errors\n///\n/// Propagates [`PyErr`] from [`PyModule::add_function`].\npub(crate) fn register_generated(m: &Bound<'_, PyModule>) -> PyResult<()> {{\n{}\n    Ok(())\n}}\n",
        imports.join("\n"),
        registrations.join("\n")
    ))
}

fn emit_ruby_register(ir: &Ir) -> String {
    let header = generated_header(crate::header::CommentStyle::ModuleDoc, "ruby-bindings-out");
    let mut imports = vec!["use crate::client::SolvaPayClient;".to_string()];
    let mut registrations = Vec::new();
    for (module, artifact) in [
        ("decisions", IrBindingArtifact::Decisions),
        ("payload_builders", IrBindingArtifact::PayloadBuilders),
    ] {
        for symbol in symbols_for(ir, artifact) {
            imports.push(format!("use crate::{module}::{};", symbol.rust_fn_name));
            registrations.push(format!(
                "    native.define_singleton_method(\"{}\", function!({}, 1))?;",
                symbol.names.rb, symbol.rust_fn_name
            ));
        }
    }
    for symbol in symbols_for(ir, IrBindingArtifact::Client) {
        registrations.push(format!(
            "    client.define_method(\"{}\", method!(SolvaPayClient::{}, 1))?;",
            symbol.names.rb, symbol.names.rb
        ));
    }
    format!(
        "{header}//! Registers every generated Magnus envelope function (Step 44).\n\nuse magnus::prelude::*;\nuse magnus::{{function, method, Error, RClass, RModule}};\n\n{}\n\n/// Registers generated sync functions and client methods.\npub(crate) fn register_generated(native: RModule, client: RClass) -> Result<(), Error> {{\n{}\n    Ok(())\n}}\n",
        imports.join("\n"),
        registrations.join("\n")
    )
}

fn sync_body(sym: &IrBindingSymbol, toolchain: Toolchain) -> String {
    match &sym.call {
        IrBindingCall::Verbatim => {
            let node = sym.verbatim_body.as_deref().unwrap_or_default();
            match toolchain {
                Toolchain::Wasm => sym
                    .verbatim_body_wasm
                    .as_deref()
                    .unwrap_or(node)
                    .to_string(),
                Toolchain::Node
                | Toolchain::Python
                | Toolchain::Ruby
                | Toolchain::Go
                | Toolchain::C => node.to_string(),
            }
        }
        IrBindingCall::Wrap { serialize, args } => {
            let mut lines: Vec<String> = Vec::new();
            let args_bind = if sym.args.is_empty() { "_args" } else { "args" };
            lines.push(format!("let {args_bind} = args_map(&args_json)?;"));
            for arg in &sym.args {
                lines.push(extract_line(arg));
            }
            let call_args = args.join(", ");
            let core = sym.core_call.as_deref().unwrap_or_default();
            lines.push(serialize_expr(*serialize, core, &call_args));
            lines.join("\n")
        }
    }
}

pub(crate) fn serialize_expr(kind: IrSerializeKind, core: &str, args: &str) -> String {
    match kind {
        IrSerializeKind::ToValue => format!("to_value(&{core}({args}))"),
        IrSerializeKind::ValueBool => format!("Ok(Value::Bool({core}({args})))"),
        IrSerializeKind::ValueString => format!("Ok(Value::String({core}({args})))"),
        IrSerializeKind::ValueArray => format!("Ok(Value::Array({core}({args})))"),
        IrSerializeKind::OptionHelperErr => format!("option_helper_err({core}({args}))"),
        IrSerializeKind::ResultAsValue => format!("result_as_value({core}({args}))"),
        IrSerializeKind::ClientAwait
        | IrSerializeKind::ClientSplit
        | IrSerializeKind::ClientIgnore => {
            // Client serialize forms never reach the sync body emitter.
            String::new()
        }
    }
}

pub(crate) fn extract_line(arg: &IrBindingArg) -> String {
    let local = arg
        .local
        .clone()
        .unwrap_or_else(|| default_snake(&arg.name));
    let name = &arg.name;
    match arg.extract {
        IrExtractKind::RequireString => {
            format!("let {local} = require_string(&args, \"{name}\")?;")
        }
        IrExtractKind::OptionalString => {
            format!("let {local} = optional_string(&args, \"{name}\")?;")
        }
        IrExtractKind::RequireF64 => format!("let {local} = require_f64(&args, \"{name}\")?;"),
        IrExtractKind::OptionalF64 => format!("let {local} = optional_f64(&args, \"{name}\")?;"),
        IrExtractKind::RequireI64 => format!("let {local} = require_i64(&args, \"{name}\")?;"),
        IrExtractKind::RequireU32 => format!("let {local} = require_u32(&args, \"{name}\")?;"),
        IrExtractKind::OptionalU16 => format!("let {local} = optional_u16(&args, \"{name}\")?;"),
        IrExtractKind::OptionalU32 => format!("let {local} = optional_u32(&args, \"{name}\")?;"),
        IrExtractKind::OptionalU64 => format!("let {local} = optional_u64(&args, \"{name}\")?;"),
        IrExtractKind::RequireBool => format!("let {local} = require_bool(&args, \"{name}\")?;"),
        IrExtractKind::RequireObject => {
            format!("let {local} = require_object(&args, \"{name}\")?;")
        }
        IrExtractKind::RequireArray => format!("let {local} = require_array(&args, \"{name}\")?;"),
        IrExtractKind::RequireTyped => typed_line("require_typed", arg, &local),
        IrExtractKind::OptionalTyped => typed_line("optional_typed", arg, &local),
        IrExtractKind::OptionalValue => format!("let {local} = optional_value(&args, \"{name}\");"),
        IrExtractKind::RawValueOrNull => {
            format!("let {local} = args.get(\"{name}\").cloned().unwrap_or(Value::Null);")
        }
    }
}

fn typed_line(helper: &str, arg: &IrBindingArg, local: &str) -> String {
    let name = &arg.name;
    let ty = arg.typed_as.as_deref().unwrap_or("Value");
    match arg.typed_style {
        IrTypedStyle::Turbofish => {
            format!("let {local} = {helper}::<{ty}>(&args, \"{name}\")?;")
        }
        IrTypedStyle::Annotation => {
            format!("let {local}: {ty} = {helper}(&args, \"{name}\")?;")
        }
    }
}

// --- helpers -----------------------------------------------------------------

fn symbols_for(ir: &Ir, artifact: IrBindingArtifact) -> Vec<&IrBindingSymbol> {
    let mut out: Vec<&IrBindingSymbol> = ir
        .binding_symbols
        .values()
        .filter(|s| s.artifact == artifact)
        .collect();
    out.sort_by(|a, b| a.emit_order.cmp(&b.emit_order).then(a.id.cmp(&b.id)));
    out
}

fn maybe_push_section<'a>(
    chunks: &mut Vec<String>,
    prev: &mut Option<&'a str>,
    sym: &'a IrBindingSymbol,
    render: impl Fn(&str) -> String,
) {
    if sym.section.as_deref() != *prev {
        *prev = sym.section.as_deref();
        if let Some(section) = sym.section.as_deref() {
            chunks.push(render(section));
        }
    }
}

fn plain_section(section: &str) -> String {
    format!("// --- {section} ---")
}

fn payload_wasm_section(section: &str) -> String {
    let suffix = if section == MCP_SECTION {
        "edge-only"
    } else {
        "public-safe"
    };
    format!("// --- {section} ({suffix}) ---")
}

fn client_section(section: &str) -> String {
    // Committed format: 4-space indent + `// --- {section} ` padded with dashes
    // to a total line width of 80.
    let prefix = format!("    // --- {section} ");
    let dashes = 80usize.saturating_sub(prefix.len());
    format!("{prefix}{}", "-".repeat(dashes))
}

fn attr_macro(toolchain: Toolchain, export_name: &str) -> String {
    match toolchain {
        Toolchain::Node => format!("#[napi(js_name = \"{export_name}\")]"),
        Toolchain::Wasm => format!("#[wasm_bindgen(js_name = \"{export_name}\")]"),
        Toolchain::Python => format!("#[pyfunction(name = \"{export_name}\")]"),
        Toolchain::Ruby | Toolchain::Go | Toolchain::C => String::new(),
    }
}

fn clone_ty(toolchain: Toolchain) -> &'static str {
    match toolchain {
        Toolchain::Node | Toolchain::Python | Toolchain::Ruby | Toolchain::C => "Arc",
        Toolchain::Wasm | Toolchain::Go => "Rc",
    }
}

fn pick_doc(sym: &IrBindingSymbol, toolchain: Toolchain) -> &str {
    match toolchain {
        Toolchain::Wasm => sym.doc_wasm.as_deref().unwrap_or(&sym.doc),
        Toolchain::Node | Toolchain::Python | Toolchain::Ruby | Toolchain::Go | Toolchain::C => {
            &sym.doc
        }
    }
}

fn render_doc(doc: &str) -> String {
    if doc.is_empty() {
        return String::new();
    }
    doc.split('\n')
        .map(|line| {
            if line.is_empty() {
                "///".to_string()
            } else {
                format!("/// {line}")
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn core_call(sym: &IrBindingSymbol) -> GenResult<&str> {
    sym.core_call
        .as_deref()
        .ok_or_else(|| GenError::Parse(format!("symbol {} missing coreCall", sym.id)))
}

/// Body-parse local name for a `clientSplit` method, derived from the last
/// call arg (`"params"` or `"Some(overrides)"` → `overrides`).
fn body_local_name(sym: &IrBindingSymbol) -> String {
    let last = sym
        .client_call_args
        .last()
        .map(String::as_str)
        .unwrap_or("");
    last.trim_start_matches("Some(")
        .trim_end_matches(')')
        .to_string()
}

fn default_snake(name: &str) -> String {
    let mut out = String::with_capacity(name.len() + 4);
    for (i, ch) in name.chars().enumerate() {
        if ch.is_ascii_uppercase() {
            if i != 0 {
                out.push('_');
            }
            out.push(ch.to_ascii_lowercase());
        } else {
            out.push(ch);
        }
    }
    out
}

fn bindings_flag(toolchain: Toolchain) -> &'static str {
    match toolchain {
        Toolchain::Node => "node-bindings-out",
        Toolchain::Wasm => "wasm-bindings-out",
        Toolchain::Python => "python-bindings-out",
        Toolchain::Ruby => "ruby-bindings-out",
        Toolchain::Go => "go-bindings-out",
        Toolchain::C => "c-bindings-out",
    }
}

fn strip_generated_prefix(content: &str) -> &str {
    let mut rest = content;
    loop {
        let Some((line, tail)) = rest.split_once('\n') else {
            if rest.contains("@generated")
                || rest.contains("Code generated by dto-gen. DO NOT EDIT.")
            {
                return "";
            }
            return rest;
        };
        if line.contains("@generated") || line.contains("Code generated by dto-gen. DO NOT EDIT.") {
            rest = tail;
            continue;
        }
        return rest;
    }
}

fn with_generated_header(content: &str, toolchain: Toolchain) -> String {
    let header = generated_header(
        crate::header::CommentStyle::ModuleDoc,
        bindings_flag(toolchain),
    );
    format!("{header}{}", strip_generated_prefix(content))
}

fn chrome_str<'a>(art: &'a Value, path: &[&str]) -> GenResult<&'a str> {
    let mut cur = art;
    for key in path {
        cur = cur.get(*key).ok_or_else(|| {
            GenError::Parse(format!("snapshot chrome missing {}", path.join(".")))
        })?;
    }
    cur.as_str().ok_or_else(|| {
        GenError::Parse(format!(
            "snapshot chrome {} is not a string",
            path.join(".")
        ))
    })
}

fn is_mcp_composite(sym: &IrBindingSymbol) -> bool {
    sym.section.as_deref() == Some("MCP composite")
}

fn solvapay_dto_import_ident(dto: &str) -> Option<&str> {
    if dto.contains("::") {
        None
    } else {
        Some(dto)
    }
}

fn mcp_symbol_ids(chrome: &Value) -> GenResult<Vec<String>> {
    let ids = chrome
        .get("artifacts")
        .and_then(|a| a.get("wasm"))
        .and_then(|w| w.get("payloadBuilders"))
        .and_then(|p| p.get("mcpPayloadModuleSymbolIds"))
        .and_then(Value::as_array)
        .ok_or_else(|| GenError::Parse("snapshot missing mcpPayloadModuleSymbolIds".into()))?;
    Ok(ids
        .iter()
        .filter_map(|v| v.as_str().map(str::to_owned))
        .collect())
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
mod tests {
    use super::*;
    use crate::ir::{
        IrBindingCall, IrBindingCatalogLink, IrEnvelopeMode, IrLangNames, IrSerializeKind,
        IrSyncKind,
    };
    use std::collections::BTreeMap;

    fn names(ts: &str, rust: &str) -> IrLangNames {
        IrLangNames {
            ts: ts.into(),
            py: rust.into(),
            rb: rust.into(),
            go: rust.into(),
            rust: rust.into(),
            c: ts.into(),
        }
    }

    fn ir_with(symbols: Vec<IrBindingSymbol>) -> Ir {
        let mut ir = Ir {
            types: BTreeMap::new(),
            overlay_helpers: BTreeMap::new(),
            overlays: BTreeMap::new(),
            routes: vec![],
            error_templates: crate::ir::IrErrorTemplates::default(),
            entry_points: BTreeMap::new(),
            binding_symbols: BTreeMap::new(),
            core_types: BTreeMap::new(),
            core_types_ts: Default::default(),
            core_fns: Default::default(),
            transport_fns: Default::default(),
        };
        for symbol in symbols {
            ir.binding_symbols.insert(symbol.id.clone(), symbol);
        }
        ir
    }

    fn client_op(
        id: &str,
        rust: &str,
        emit_order: u32,
        serialize: IrSerializeKind,
        split: &[&str],
        dto: Option<&str>,
        client_call_args: &[&str],
    ) -> IrBindingSymbol {
        IrBindingSymbol {
            id: id.into(),
            core: format!("solvapay_transport::SolvaPayClient::{rust}"),
            names: names(id, rust),
            catalog: IrBindingCatalogLink::Operation(id.into()),
            args: vec![],
            split_path_refs: split.iter().map(|s| (*s).to_string()).collect(),
            return_shape: "value".into(),
            sync: IrSyncKind::Async,
            envelope: IrEnvelopeMode::Async,
            artifact: IrBindingArtifact::Client,
            emit_order,
            section: Some("Group A".into()),
            doc: format!("`{id}`"),
            doc_wasm: None,
            rust_fn_name: rust.into(),
            call: IrBindingCall::Wrap {
                serialize,
                args: vec![],
            },
            verbatim_body: None,
            verbatim_body_wasm: None,
            dto_type: dto.map(ToOwned::to_owned),
            core_call: Some(rust.into()),
            client_call_args: client_call_args.iter().map(|s| (*s).to_string()).collect(),
            ts_wrapper: None,
        }
    }

    #[test]
    fn generated_header_is_prepended_once() {
        assert_eq!(
            with_generated_header("//! x\n", Toolchain::Node),
            "//! @generated by dto-gen (--node-bindings-out) — do not edit. Regenerate with: pnpm gen\n//! x\n"
        );
        let twice = with_generated_header(
            &with_generated_header("//! x\n", Toolchain::Node),
            Toolchain::Node,
        );
        assert_eq!(twice.matches("@generated").count(), 1);
    }

    #[test]
    fn client_section_is_80_wide() {
        let line = client_section("Group B");
        assert_eq!(line.len(), 80);
        assert!(line.starts_with("    // --- Group B "));
        assert!(line.ends_with('-'));
    }

    #[test]
    fn extract_line_require_string() {
        let arg = IrBindingArg {
            name: "customerRef".into(),
            ty: crate::ir::IrBoundaryType::String,
            required: true,
            host_injected: false,
            extract: IrExtractKind::RequireString,
            typed_as: None,
            typed_style: IrTypedStyle::Turbofish,
            local: Some("customer_ref".into()),
        };
        assert_eq!(
            extract_line(&arg),
            "let customer_ref = require_string(&args, \"customerRef\")?;"
        );
    }

    #[test]
    fn extract_line_typed_annotation_vs_turbofish() {
        let base = IrBindingArg {
            name: "structuredContent".into(),
            ty: crate::ir::IrBoundaryType::Value,
            required: true,
            host_injected: false,
            extract: IrExtractKind::RequireTyped,
            typed_as: Some("PaywallGate".into()),
            typed_style: IrTypedStyle::Annotation,
            local: Some("gate".into()),
        };
        assert_eq!(
            extract_line(&base),
            "let gate: PaywallGate = require_typed(&args, \"structuredContent\")?;"
        );
        let turbofish = IrBindingArg {
            typed_style: IrTypedStyle::Turbofish,
            ..base
        };
        assert_eq!(
            extract_line(&turbofish),
            "let gate = require_typed::<PaywallGate>(&args, \"structuredContent\")?;"
        );
    }

    #[test]
    fn serialize_expr_forms() {
        assert_eq!(
            serialize_expr(
                IrSerializeKind::ToValue,
                "classify_customer_ref",
                "&customer_ref"
            ),
            "to_value(&classify_customer_ref(&customer_ref))"
        );
        assert_eq!(
            serialize_expr(IrSerializeKind::OptionHelperErr, "f", "a, b"),
            "option_helper_err(f(a, b))"
        );
    }

    #[test]
    fn emits_verbatim_body_for_retry() {
        let ir = ir_with(vec![IrBindingSymbol {
            id: "retryNextDelayMs".into(),
            core: "solvapay_core::retry::retry_next_delay_ms".into(),
            names: names("retryNextDelayMs", "retry_next_delay_ms"),
            catalog: IrBindingCatalogLink::None,
            args: vec![],
            split_path_refs: vec![],
            return_shape: "value".into(),
            sync: IrSyncKind::Sync,
            envelope: IrEnvelopeMode::Sync,
            artifact: IrBindingArtifact::Decisions,
            emit_order: 0,
            section: Some("retry".into()),
            doc: "Binding for `retryNextDelayMs`.".into(),
            doc_wasm: None,
            rust_fn_name: "retry_next_delay_ms".into(),
            call: IrBindingCall::Verbatim,
            verbatim_body: Some("let x = 1;\nOk(Value::from(x))".into()),
            verbatim_body_wasm: None,
            dto_type: None,
            core_call: None,
            client_call_args: vec![],
            ts_wrapper: None,
        }]);
        let sym = ir.binding_symbols.get("retryNextDelayMs").unwrap();
        let out = emit_sync_fn(sym, Toolchain::Node);
        assert!(out.contains("#[napi(js_name = \"retryNextDelayMs\")]"));
        assert!(out.contains("pub fn retry_next_delay_ms(args_json: String) -> String"));
        assert!(out.contains("Ok(Value::from(x))"));
    }

    #[test]
    fn emits_client_await_and_split() {
        let ir = ir_with(vec![
            client_op(
                "createCustomer",
                "create_customer",
                0,
                IrSerializeKind::ClientAwait,
                &[],
                Some("CreateCustomerRequest"),
                &[],
            ),
            client_op(
                "updateCustomer",
                "update_customer",
                1,
                IrSerializeKind::ClientSplit,
                &["customerRef"],
                Some("UpdateCustomerParams"),
                &["&refs[0]", "params"],
            ),
        ]);
        let create = ir.binding_symbols.get("createCustomer").unwrap();
        let node = emit_client_method(create, Toolchain::Node).unwrap();
        assert!(node.contains("let client = Arc::clone(&self.client);"));
        assert!(node.contains("let params: CreateCustomerRequest = parse_args_json(&args_json)?;"));

        let wasm = emit_client_method(create, Toolchain::Wasm).unwrap();
        assert!(wasm.contains("let client = Rc::clone(&self.client);"));
        assert!(wasm.contains("#[wasm_bindgen(js_name = \"createCustomer\")]"));

        let update = ir.binding_symbols.get("updateCustomer").unwrap();
        let split = emit_client_method(update, Toolchain::Node).unwrap();
        assert!(
            split.contains("let (refs, body) = split_path_refs(&args_json, &[\"customerRef\"])?;")
        );
        assert!(split.contains("let params: UpdateCustomerParams = serde_json::from_value(body)"));
        assert!(split.contains("invalid updateCustomer body"));
        assert!(split.contains("client.update_customer(&refs[0], params).await"));

        let go_await = emit_go_client_method(create).unwrap();
        assert!(go_await.contains("sv_create_customer"));
        assert!(go_await.contains("let args_json = read_string"));
        assert!(
            go_await.contains("let params: CreateCustomerRequest = parse_args_json(&args_json)?;")
        );
        assert!(go_await.contains("pollster::block_on(run_envelope"));
        assert!(
            !go_await.contains("})\n        .await"),
            "Go guest must drive the future with pollster, not `.await` the envelope"
        );

        let go_split = emit_go_client_method(update).unwrap();
        assert!(go_split
            .contains("let (refs, body) = split_path_refs(&args_json, &[\"customerRef\"])?;"));
        assert!(
            go_split.contains("let params: UpdateCustomerParams = serde_json::from_value(body)")
        );
        assert!(go_split.contains("client.update_customer(&refs[0], params).await"));
        assert!(go_split.contains("pollster::block_on(run_envelope"));

        let c_emitted = emit_bindings(&ir, Toolchain::C).unwrap();
        assert!(c_emitted.client_rs.contains("\"createCustomer\" =>"));
        assert!(c_emitted.client_rs.contains("runtime::runtime().block_on"));
        assert!(c_emitted
            .client_rs
            .contains("let params: CreateCustomerRequest = parse_args_json(&args_json)?;"));
        assert!(c_emitted
            .client_rs
            .contains("let (refs, body) = split_path_refs(&args_json, &[\"customerRef\"])?;"));
        assert!(c_emitted.client_rs.contains("\"updateCustomer\" =>"));
    }

    #[test]
    fn ruby_registration_does_not_require_function_attributes() {
        assert_eq!(attr_macro(Toolchain::Ruby, "get_merchant"), "");
    }

    #[test]
    fn clone_ty_ruby_is_arc() {
        assert_eq!(clone_ty(Toolchain::Ruby), "Arc");
    }

    #[test]
    fn emits_full_ruby_client_and_registration() {
        let ir = ir_with(vec![
            client_op(
                "getMerchant",
                "get_merchant",
                0,
                IrSerializeKind::ClientIgnore,
                &[],
                None,
                &[],
            ),
            client_op(
                "createCustomer",
                "create_customer",
                1,
                IrSerializeKind::ClientAwait,
                &[],
                Some("CreateCustomerRequest"),
                &[],
            ),
        ]);
        let emitted = emit_bindings(&ir, Toolchain::Ruby).unwrap();
        assert!(emitted
            .client_rs
            .contains("pub(crate) fn get_merchant(&self, args_json: String) -> String"));
        assert!(emitted.client_rs.contains("without_gvl(||"));
        assert!(emitted
            .client_rs
            .contains("runtime::get_runtime().block_on"));
        assert!(emitted.client_rs.contains("client.get_merchant().await"));
        assert!(
            emitted.client_rs.contains("fn create_customer"),
            "Step 44 emits all client methods"
        );
        assert!(emitted.register_rs.contains("\"create_customer\""));
        assert!(emitted.args_rs.contains("fn args_map"));
    }
}
