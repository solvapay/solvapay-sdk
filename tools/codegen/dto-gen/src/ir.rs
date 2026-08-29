//! Typed intermediate representation for OpenAPI wire models + SDK overlays.
//!
//! Emitters consume only this IR (§5.6). Building the IR from the same snapshot
//! must be deterministic (sorted maps / stable iteration).

use std::collections::{BTreeMap, BTreeSet};

/// Complete IR produced from one OpenAPI snapshot (+ optional manifest overlays).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Ir {
    /// Named wire types keyed by Rust type name (PascalCase), sorted.
    pub types: BTreeMap<String, IrType>,
    /// Helper types created while lowering overlays (not OpenAPI schemas).
    pub overlay_helpers: BTreeMap<String, IrType>,
    /// SDK-only overlay types keyed by overlay name, sorted.
    pub overlays: BTreeMap<String, IrOverlay>,
    /// HTTP routes with request/response body type refs.
    pub routes: Vec<IrRoute>,
    /// Frozen error message templates from the contract manifest (step 17).
    pub error_templates: IrErrorTemplates,
    /// Catalogued entry points (operations + topLevel + facade + coreHelpers).
    pub entry_points: BTreeMap<String, IrEntryPoint>,
    /// Binding-boundary symbols (§5.7 / step 39G-a), keyed by canonical id.
    pub binding_symbols: BTreeMap<String, IrBindingSymbol>,
    /// Exported `solvapay-core` structs/enums (Phase 2), keyed by Rust type name.
    pub core_types: BTreeMap<String, IrCoreType>,
    /// TS-only residue for the core boundary-type emitter (Phase 3a).
    pub core_types_ts: IrCoreTypesTs,
    /// Scanned `pub fn` signatures from `solvapay-core` (Phase 3b).
    pub core_fns: BTreeMap<String, IrCoreFn>,
    /// Scanned `pub fn` signatures from `solvapay-transport` (Phase 4b).
    pub transport_fns: BTreeMap<String, IrCoreFn>,
}

/// Manifest overlay that maps Rust core types onto the public TypeScript surface.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct IrCoreTypesTs {
    /// Rust type names that must not be emitted under their own name.
    pub omit: BTreeSet<String>,
    /// Extra TS names that alias a Rust type (with optional field omissions).
    pub aliases: BTreeMap<String, IrCoreTsAlias>,
    /// Rust type name → public TS type name.
    pub rename: BTreeMap<String, String>,
    /// Public TS type name → verbatim RHS (union / generic / inlined shape).
    pub reshape: BTreeMap<String, String>,
    /// Extra TS types with no Rust counterpart; value is the verbatim RHS.
    pub extra: BTreeMap<String, String>,
}

/// One `boundaryTypesTs.aliases` entry.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct IrCoreTsAlias {
    /// Rust type this alias copies.
    pub of: String,
    /// Wire field names to drop from the alias body.
    pub omit_fields: BTreeSet<String>,
}

/// Parsed `#[solvapay_export(...)]` arguments (Phase 4).
///
/// Only what the signature cannot say. Missing keys stay `None` / empty.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct IrExportAttr {
    /// Canonical binding id when it is not camelCase of the Rust fn.
    pub id: Option<String>,
    /// Generated shim file (`decisions` | `payloadBuilders` | `client` | `webhook`).
    pub artifact: Option<String>,
    /// Catalog kind (`none` | `operation` | `topLevel` | `coreHelper` | `facade`).
    pub catalog: Option<String>,
    /// Section marker preceding the symbol.
    pub section: Option<String>,
    /// Stable emit order within the artifact.
    pub emit_order: Option<u32>,
    /// Sync-kind override (`sync` | `async`).
    pub sync: Option<String>,
    /// Envelope-mode override (`sync` | `async` | `webhookThrow`).
    pub envelope: Option<String>,
    /// Arg camelCase names injected by the host adapter.
    pub host_injected: Vec<String>,
    /// Arg camelCase name → turbofish/annotation type for typed extracts.
    pub typed_as: BTreeMap<String, String>,
    /// Arg camelCase name → `turbofish` | `annotation`.
    pub typed_style: BTreeMap<String, String>,
    /// Arg camelCase name → extract kind override (`rawValueOrNull`, …).
    pub extract: BTreeMap<String, String>,
    /// Arg camelCase name → local binding name override.
    pub local: BTreeMap<String, String>,
    /// Rust param name → JSON arg key when they differ.
    pub rename: BTreeMap<String, String>,
    /// Shim fn name when it is not `{fn}_binding`.
    pub rust_fn_name: Option<String>,
    /// Client DTO parsed from args JSON.
    pub dto_type: Option<String>,
    /// Ordered path-ref split keys (client symbols).
    pub split_path_refs: Vec<String>,
}

/// A scanned `solvapay-core` function signature.
#[derive(Debug, Clone, PartialEq)]
pub struct IrCoreFn {
    /// Rust function identifier.
    pub name: String,
    /// Module path relative to `solvapay-core::`.
    pub module: String,
    /// Inherent-impl type name when this is a method (`RetryPolicy`), else `None`.
    pub impl_ty: Option<String>,
    /// Crate prefix (`solvapay_core` or `solvapay_transport`). Empty means core.
    pub crate_name: String,
    /// Joined `///` rustdoc body.
    pub rustdoc: String,
    /// Parameters in source order.
    pub params: Vec<IrCoreParam>,
    /// Return type (`optional` means `Option<T>`).
    pub return_ty: IrCoreParamTy,
    /// Present when the item carries `#[solvapay_export]`.
    pub exported: Option<IrExportAttr>,
    /// `async fn`.
    pub is_async: bool,
}

impl IrCoreFn {
    /// Crate used in `core` paths (`solvapay_core` when unset).
    #[must_use]
    pub fn crate_prefix(&self) -> &str {
        if self.crate_name.is_empty() {
            "solvapay_core"
        } else {
            &self.crate_name
        }
    }

    /// Scanner index key (`{crate}::{module}::{name}`, full module path).
    #[must_use]
    pub fn core_path(&self) -> String {
        Self::format_core(
            self.crate_prefix(),
            &self.module,
            self.impl_ty.as_deref(),
            &self.name,
        )
    }

    /// Snapshot `core` path. Core uses the first module segment; transport omits
    /// the module (`solvapay_transport::SolvaPayClient::{name}`).
    #[must_use]
    pub fn binding_core(&self) -> String {
        if self.crate_prefix() == "solvapay_transport" {
            return Self::format_core(self.crate_prefix(), "", self.impl_ty.as_deref(), &self.name);
        }
        let head = self.module.split("::").next().unwrap_or("");
        Self::format_core(
            self.crate_prefix(),
            head,
            self.impl_ty.as_deref(),
            &self.name,
        )
    }

    fn format_core(crate_name: &str, module: &str, impl_ty: Option<&str>, name: &str) -> String {
        match (module, impl_ty) {
            (m, Some(ty)) if !m.is_empty() => format!("{crate_name}::{m}::{ty}::{name}"),
            (_, Some(ty)) => format!("{crate_name}::{ty}::{name}"),
            (m, None) if !m.is_empty() => format!("{crate_name}::{m}::{name}"),
            (_, None) => format!("{crate_name}::{name}"),
        }
    }
}

/// One scanned function parameter.
#[derive(Debug, Clone, PartialEq)]
pub struct IrCoreParam {
    /// Rust parameter identifier (`_` when the source used a wildcard).
    pub rust_name: String,
    /// True when the source type is a reference (`&T`, `&str`, `&[T]`).
    pub by_ref: bool,
    /// Parameter type (`optional` means `Option<T>`).
    pub ty: IrCoreParamTy,
}

/// Function parameter / return type after unwrapping a top-level `Option`.
#[derive(Debug, Clone, PartialEq)]
pub struct IrCoreParamTy {
    /// True when the Rust type is `Option<T>` (unwrapped into [`Self::ty`]).
    pub optional: bool,
    /// Unwrapped type.
    pub ty: IrCoreFieldTy,
}

/// Which serde derives a core type carries.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum IrCoreSerde {
    /// Neither `Serialize` nor `Deserialize`.
    #[default]
    None,
    /// `Serialize` only.
    Serialize,
    /// `Deserialize` only.
    Deserialize,
    /// Both `Serialize` and `Deserialize`.
    Both,
}

/// A `solvapay-core` struct or enum extracted by the Phase 2 scanner.
#[derive(Debug, Clone, PartialEq)]
pub struct IrCoreType {
    /// Rust type name (PascalCase).
    pub name: String,
    /// Module path relative to `solvapay-core::` (`customer_sync`, `mcp::envelope`).
    pub module: String,
    /// Joined `///` rustdoc body (no `///` prefix).
    pub rustdoc: String,
    /// Serde derive presence.
    pub serde: IrCoreSerde,
    /// Optional `#[cfg(feature = "...")]` on the item.
    pub cfg_feature: Option<String>,
    /// Struct vs enum shape.
    pub shape: IrCoreShape,
}

/// Structural shape of a core type, including serde tag/rename policy.
#[derive(Debug, Clone, PartialEq)]
pub enum IrCoreShape {
    /// Named-field struct.
    Struct {
        /// `#[serde(rename_all = "...")]` when present.
        rename_all: Option<String>,
        /// Fields in source order.
        fields: Vec<IrCoreField>,
    },
    /// All-unit enum (string union on the wire).
    UnitEnum {
        /// `#[serde(rename_all = "...")]` when present.
        rename_all: Option<String>,
        /// Variants in source order.
        variants: Vec<IrCoreVariant>,
    },
    /// Internally tagged enum (`#[serde(tag = "...")]`).
    TaggedEnum {
        /// Tag property name.
        tag: String,
        /// `#[serde(rename_all = "...")]` when present.
        rename_all: Option<String>,
        /// Variants in source order.
        variants: Vec<IrCoreVariant>,
    },
    /// `#[serde(untagged)]` enum.
    UntaggedEnum {
        /// `#[serde(rename_all = "...")]` when present.
        rename_all: Option<String>,
        /// Variants in source order.
        variants: Vec<IrCoreVariant>,
    },
}

/// One struct field or named enum-variant field.
#[derive(Debug, Clone, PartialEq)]
pub struct IrCoreField {
    /// Rust field identifier.
    pub rust_name: String,
    /// JSON key after serde rename / rename_all.
    pub wire_name: String,
    /// Field rustdoc body.
    pub rustdoc: String,
    /// True when the Rust type is `Option<T>` (unwrapped into [`Self::ty`]).
    pub optional: bool,
    /// `skip_serializing_if` path, when present.
    pub skip_serializing_if: Option<String>,
    /// `#[serde(default)]` on the field.
    pub serde_default: bool,
    /// `serialize_with` helper path, when present.
    pub serialize_with: Option<String>,
    /// Optional `#[cfg(feature = "...")]` on the field.
    pub cfg_feature: Option<String>,
    /// Unwrapped field type (`Option` is represented by [`Self::optional`]).
    pub ty: IrCoreFieldTy,
}

/// One enum variant (unit or named-field).
#[derive(Debug, Clone, PartialEq)]
pub struct IrCoreVariant {
    /// Rust variant identifier.
    pub rust_name: String,
    /// Wire tag / unit value after serde rename / rename_all.
    pub wire_name: String,
    /// Variant rustdoc body.
    pub rustdoc: String,
    /// Named fields (empty for a unit variant).
    pub fields: Vec<IrCoreField>,
    /// Optional `#[cfg(feature = "...")]` on the variant.
    pub cfg_feature: Option<String>,
}

/// Field type after unwrapping a field-level `Option`.
#[derive(Debug, Clone, PartialEq)]
pub enum IrCoreFieldTy {
    /// `String`.
    String,
    /// `bool`.
    Bool,
    /// Unsigned 16-bit integer.
    U16,
    /// Unsigned 32-bit integer.
    U32,
    /// Unsigned 64-bit integer.
    U64,
    /// Signed 64-bit integer.
    I64,
    /// `f64` (may still carry `serialize_with` for whole-number JSON).
    F64,
    /// `serde_json::Value`.
    Value,
    /// `()` unit return (functions only).
    Unit,
    /// Anonymous tuple `(T, U, …)`.
    Tuple(Vec<IrCoreFieldTy>),
    /// `Vec<T>`.
    Vec(Box<IrCoreFieldTy>),
    /// `Map<String, V>` / `BTreeMap<String, V>`.
    Map(Box<IrCoreFieldTy>),
    /// Named core type (last path segment).
    Named(String),
    /// `Result<T, E>`.
    Result {
        /// Success type.
        ok: Box<IrCoreFieldTy>,
        /// Error type.
        err: Box<IrCoreFieldTy>,
    },
}

/// Envelope mode at the binding boundary (§5.7).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IrEnvelopeMode {
    /// Sync `run_envelope_sync`.
    Sync,
    /// Async `run_envelope`.
    Async,
    /// Webhook-throw exception path (not JSON envelope).
    WebhookThrow,
}

/// Boundary type for a JSON-arg extractor (§5.7 matrix).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IrBoundaryType {
    /// Required string.
    String,
    /// Optional string.
    StringOpt,
    /// Required f64 / JS number.
    F64,
    /// Optional f64.
    F64Opt,
    /// Required i64 (host-injected clocks often use this).
    I64,
    /// Boolean.
    Bool,
    /// Opaque JSON value passthrough.
    Value,
}

/// Extractor helper used to pull one arg out of the combined args JSON (§5.7).
///
/// Separate from [`IrBoundaryType`] — the boundary type describes the public
/// surface, the extract kind is the exact `args.rs` helper the shim body calls.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IrExtractKind {
    /// `require_string(&args, "k")?`
    RequireString,
    /// `optional_string(&args, "k")?`
    OptionalString,
    /// `require_f64(&args, "k")?`
    RequireF64,
    /// `optional_f64(&args, "k")?`
    OptionalF64,
    /// `require_i64(&args, "k")?`
    RequireI64,
    /// `require_u32(&args, "k")?`
    RequireU32,
    /// `optional_u16(&args, "k")?`
    OptionalU16,
    /// `optional_u32(&args, "k")?`
    OptionalU32,
    /// `optional_u64(&args, "k")?`
    OptionalU64,
    /// `require_bool(&args, "k")?`
    RequireBool,
    /// `require_object(&args, "k")?`
    RequireObject,
    /// `require_array(&args, "k")?`
    RequireArray,
    /// `require_typed::<T>(&args, "k")?`
    RequireTyped,
    /// `optional_typed::<T>(&args, "k")?`
    OptionalTyped,
    /// `optional_value(&args, "k")` (no `?`)
    OptionalValue,
    /// `args.get("k").cloned().unwrap_or(Value::Null)`
    RawValueOrNull,
}

/// Rendering style for `require_typed` / `optional_typed` extract lines.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum IrTypedStyle {
    /// `let x = require_typed::<T>(&args, "k")?` (default).
    #[default]
    Turbofish,
    /// `let x: T = require_typed(&args, "k")?`.
    Annotation,
}

/// One ordered JSON-arg on a binding symbol.
#[derive(Debug, Clone, PartialEq)]
pub struct IrBindingArg {
    /// Arg key in the combined args JSON.
    pub name: String,
    /// Boundary type.
    pub ty: IrBoundaryType,
    /// Required vs optional.
    pub required: bool,
    /// Host adapter injects this arg (not the public caller).
    pub host_injected: bool,
    /// Exact extractor helper the shim body calls.
    pub extract: IrExtractKind,
    /// Turbofish / annotation type for `require_typed` / `optional_typed`.
    pub typed_as: Option<String>,
    /// Rendering style for typed extracts.
    pub typed_style: IrTypedStyle,
    /// Local binding name (`let {local} = …`).
    pub local: Option<String>,
}

/// Optional link from a binding symbol back to the §5.6 catalog.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IrBindingCatalogLink {
    /// Internal core with no public catalog entry.
    None,
    /// Client operation.
    Operation(String),
    /// Top-level helper.
    TopLevel(String),
    /// Core helper.
    CoreHelper(String),
    /// Facade entry.
    Facade(String),
}

/// Which generated shim file a binding symbol is emitted into (step 39G-b).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IrBindingArtifact {
    /// Sync decision / paywall / retry cores → `decisions.rs`.
    Decisions,
    /// Sync core + MCP payload builders → `payload_builders.rs`.
    PayloadBuilders,
    /// Async client methods → `native_client.rs` / `wasm_client.rs`.
    Client,
    /// Webhook verify — not emitted as a generated shim file.
    Webhook,
}

/// How the shim body serializes the core call into the envelope value (§5.7).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IrSerializeKind {
    /// `to_value(&core(..))`
    ToValue,
    /// `Ok(Value::Bool(core(..)))`
    ValueBool,
    /// `Ok(Value::String(core(..)))`
    ValueString,
    /// `Ok(Value::Array(core(..)))`
    ValueArray,
    /// `option_helper_err(core(..))`
    OptionHelperErr,
    /// `result_as_value(core(..))`
    ResultAsValue,
    /// Client: `parse_args_json::<Dto>` + `client.method(params).await`
    ClientAwait,
    /// Client: `split_path_refs` + optional body parse + `client.method(..).await`
    ClientSplit,
    /// Client: `client.method().await` (args ignored)
    ClientIgnore,
}

/// Shim body strategy: a structured wrap or a verbatim source blob.
#[derive(Debug, Clone, PartialEq)]
pub enum IrBindingCall {
    /// Structured extract-then-serialize wrap.
    Wrap {
        /// Serialize form.
        serialize: IrSerializeKind,
        /// Positional args passed to the core call (verbatim tokens).
        args: Vec<String>,
    },
    /// Emit the captured body source verbatim.
    Verbatim,
}

/// One binding-boundary symbol descriptor (§5.7).
#[derive(Debug, Clone, PartialEq)]
pub struct IrBindingSymbol {
    /// Canonical symbol id (matches shim `js_name` today).
    pub id: String,
    /// Fully-qualified Rust core / transport fn path.
    pub core: String,
    /// Per-toolchain export names.
    pub names: IrLangNames,
    /// Catalog link (or `None` for internal cores).
    pub catalog: IrBindingCatalogLink,
    /// Ordered JSON-args.
    pub args: Vec<IrBindingArg>,
    /// Ordered path-ref split keys.
    pub split_path_refs: Vec<String>,
    /// Envelope success-value shape marker (`value` today).
    pub return_shape: String,
    /// Sync vs async binding.
    pub sync: IrSyncKind,
    /// Envelope mode.
    pub envelope: IrEnvelopeMode,
    /// Which generated shim file this symbol lands in.
    pub artifact: IrBindingArtifact,
    /// Stable emit order within the artifact.
    pub emit_order: u32,
    /// Section marker (`// --- section ---`) preceding the symbol, if any.
    pub section: Option<String>,
    /// Doc comment body (no `///` prefix; lines joined with `\n`).
    pub doc: String,
    /// Wasm doc override when the mirror doc differs from node.
    pub doc_wasm: Option<String>,
    /// Rust fn / method name.
    pub rust_fn_name: String,
    /// Shim body strategy.
    pub call: IrBindingCall,
    /// Verbatim body source (Node) when `call == Verbatim`.
    pub verbatim_body: Option<String>,
    /// Verbatim body source override for Wasm when it differs from Node.
    pub verbatim_body_wasm: Option<String>,
    /// Client DTO type parsed from args JSON.
    pub dto_type: Option<String>,
    /// Bare core call name (method / free fn).
    pub core_call: Option<String>,
    /// Client method call args (verbatim tokens) for `ClientSplit`.
    pub client_call_args: Vec<String>,
    /// TypeScript dispatch-wrapper residue (`tsWrapper:`).
    pub ts_wrapper: Option<IrTsWrapper>,
}

/// TS-only residue on a binding symbol for core/server dispatch wrappers (Phase 3c).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct IrTsWrapper {
    /// Export name when it differs from `names.ts` (seller tax-label accessor).
    pub export_name: Option<String>,
    /// Generic clause including angle brackets (`<TGate>`).
    pub generics: Option<String>,
    /// Override for the TS return type.
    pub return_type: Option<String>,
    /// Per-parameter TS type overrides (including optionality syntax).
    pub param_types: BTreeMap<String, String>,
    /// Function-level optional-param style (`nullish` / `optional` / `optionalNull` / `undefined`).
    pub optional_style: Option<String>,
    /// Per-parameter optional style overrides.
    pub param_style: BTreeMap<String, String>,
    /// Force `dispatchSync(name, firstArg)` even when args could be wrapped.
    pub pass_through: bool,
    /// Treat the TS surface as a single object parameter.
    pub object_param: bool,
    /// Post-process the dispatch result (`nullToUndefined`).
    pub post_process: Option<String>,
    /// Verbatim object-literal fields passed to `dispatchSync`.
    pub dispatch_args: Option<String>,
    /// JSDoc body (no `/**` wrapper) for the core wrapper.
    pub doc: Option<String>,
    /// Inner comment emitted only on the server wrapper (before `return dispatchSync`).
    pub server_comment: Option<String>,
    /// Verbatim parameter list + return type (`input: { … }): PaywallOutcome<TGate>`).
    pub signature: Option<String>,
}

/// Which catalog section an entry point belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IrEntrySection {
    /// Client operation method.
    Operation,
    /// Top-level helper / class.
    TopLevel,
    /// Core helper.
    CoreHelper,
    /// Facade factory / payable surface.
    Facade,
    /// MCP sync op or layer-2 native symbol.
    Mcp,
}

/// Sync availability for TypeScript (step 18 emitters).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IrSyncKind {
    /// Returns a Promise / async function.
    Async,
    /// Synchronous function.
    Sync,
}

/// How dto-gen should treat one language for a catalogued entry.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum IrEmissionMode {
    /// Emit a generated forwarder / wrapper.
    #[default]
    Generated,
    /// Host language already owns a hand-written implementation.
    HandWritten {
        /// Non-empty justification from the contract.
        reason: String,
    },
    /// Language has no symbol.
    Omitted {
        /// Non-empty justification from the contract.
        reason: String,
    },
}

impl IrEmissionMode {
    /// True when dto-gen must emit this language.
    pub fn is_generated(&self) -> bool {
        matches!(self, Self::Generated)
    }
}

/// Per-language emission matrix (distinct from [`IrAvailability`] sync modes).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IrEmissionMatrix {
    /// TypeScript.
    pub ts: IrEmissionMode,
    /// Python.
    pub py: IrEmissionMode,
    /// Ruby.
    pub rb: IrEmissionMode,
    /// Go.
    pub go: IrEmissionMode,
    /// Rust.
    pub rust: IrEmissionMode,
    /// C ABI.
    pub c: IrEmissionMode,
}

impl Default for IrEmissionMatrix {
    fn default() -> Self {
        Self {
            ts: IrEmissionMode::Generated,
            py: IrEmissionMode::Generated,
            rb: IrEmissionMode::Generated,
            go: IrEmissionMode::Generated,
            rust: IrEmissionMode::Generated,
            c: IrEmissionMode::Generated,
        }
    }
}

/// MCP catalog surface (`syncOp` envelope vs layer-2 payload builders).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IrMcpSurface {
    /// Named wrapper over the `solvapay_call` envelope.
    SyncOp,
    /// Layer-2 native payload / descriptor helper.
    Layer2,
}

/// Per-language callable availability for a catalog entry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IrAvailability {
    /// TypeScript modes.
    pub ts: Vec<IrSyncKind>,
    /// Python modes.
    pub py: Vec<IrSyncKind>,
    /// Ruby modes.
    pub rb: Vec<IrSyncKind>,
    /// Go modes.
    pub go: Vec<IrSyncKind>,
    /// Rust modes.
    pub rust: Vec<IrSyncKind>,
}

/// Ruby public receiver/ownership kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IrRubyReceiver {
    /// `SolvaPay.helper` module function.
    ModuleFunction,
    /// `SolvaPay::Client#operation`.
    ClientInstance,
    /// High-level facade instance method such as `sp.gate`.
    FacadeInstance,
    /// Public exception class constructor.
    ErrorClass,
    /// Public Ruby constant.
    Constant,
    /// Catalogued-but-not-emitted MCP native (`SolvaPay::Mcp::Layer2`); Phase 3 owns emission.
    McpNative,
}

/// Normalized Ruby target consumed by Ruby emitters.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IrRubyTarget {
    /// Public owner (`SolvaPay`, `SolvaPay::Client`, or `SolvaPay::Facade`).
    pub owner: String,
    /// Method/constant name without owner syntax.
    pub name: String,
    /// Receiver kind.
    pub receiver: IrRubyReceiver,
    /// Whether the public method accepts a block.
    pub takes_block: bool,
}

/// Manifest-frozen runtime defaults used by parity/facade emitters.
#[derive(Debug, Clone, PartialEq)]
pub struct IrDefaults {
    /// Retry attempts after the initial call.
    pub max_retries: u32,
    /// Initial retry delay in milliseconds.
    pub initial_delay_ms: u64,
    /// Webhook timestamp tolerance in seconds.
    pub webhook_tolerance_sec: i64,
    /// Limits-cache TTL in milliseconds.
    pub limits_cache_ttl_ms: u64,
    /// Customer-dedup cache TTL in milliseconds.
    pub customer_dedup_ttl_ms: u64,
    /// Customer-dedup cache max entries.
    pub customer_dedup_max_cache_size: u32,
    /// Sentinel customer ref that skips ensure/lookup.
    pub anonymous_customer_ref: String,
    /// `trackUsage` request-id template (`{epochMs}` / `{random9}`).
    pub request_id_format: String,
    /// Frozen `trackUsage.actionType`.
    pub usage_action_type: String,
}

impl Default for IrDefaults {
    fn default() -> Self {
        Self {
            max_retries: 2,
            initial_delay_ms: 500,
            webhook_tolerance_sec: 300,
            limits_cache_ttl_ms: 10_000,
            customer_dedup_ttl_ms: 60_000,
            customer_dedup_max_cache_size: 1_000,
            anonymous_customer_ref: "anonymous".to_owned(),
            request_id_format: "solvapay_{epochMs}_{random9}".to_owned(),
            usage_action_type: "api_call".to_owned(),
        }
    }
}

/// Stable public error categories represented at every language boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IrErrorKind {
    /// Backend API failure.
    Api,
    /// Structured payment gate.
    Paywall,
    /// Webhook verification failure.
    Webhook,
    /// Transport/internal boundary failure.
    Transport,
}

/// Language-neutral doc model for one catalogued entry point (§5.6, D19).
///
/// Per-parameter descriptions stay on [`IrParam::doc`].
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct IrDocModel {
    /// Required non-empty summary (coverage gate).
    pub summary: String,
    /// Optional return description.
    pub returns: Option<String>,
}

/// One catalogued public entry point (§5.6).
#[derive(Debug, Clone, PartialEq)]
pub struct IrEntryPoint {
    /// Canonical catalog id (camelCase).
    pub id: String,
    /// Catalog section.
    pub section: IrEntrySection,
    /// Per-language names.
    pub names: IrLangNames,
    /// When true, optional on `SolvaPayClient`.
    pub optional_on_client: bool,
    /// Positional parameters.
    pub params: Vec<IrParam>,
    /// Generic type parameter names.
    pub type_params: Vec<String>,
    /// Request DTO / overlay name.
    pub request: Option<String>,
    /// Response DTO / overlay name.
    pub response: Option<String>,
    /// Typed per-language sync/async availability.
    pub availability: IrAvailability,
    /// Declared emission mode per language (generated vs skip).
    pub emission: IrEmissionMatrix,
    /// MCP surface when [`IrEntrySection::Mcp`].
    pub mcp_surface: Option<IrMcpSurface>,
    /// Optional feature gate (e.g. `engine`) when [`IrEntrySection::Mcp`].
    pub feature: Option<String>,
    /// TypeScript primary mode retained for existing TypeScript emitters.
    pub sync_ts: IrSyncKind,
    /// Normalized Ruby owner/receiver/signature target.
    pub ruby_target: IrRubyTarget,
    /// Manifest-frozen runtime defaults.
    pub defaults: IrDefaults,
    /// Stable public errors this entry can reconstruct.
    pub errors: Vec<IrErrorKind>,
    /// Shared language-neutral doc model (§5.6 / D19).
    pub docs: IrDocModel,
}

/// Per-language names in IR.
#[derive(Debug, Clone, PartialEq)]
pub struct IrLangNames {
    /// TypeScript.
    pub ts: String,
    /// Python.
    pub py: String,
    /// Ruby.
    pub rb: String,
    /// Go.
    pub go: String,
    /// Rust.
    pub rust: String,
    /// C ABI dispatch / symbol name (camelCase op id, matching TypeScript).
    pub c: String,
}

/// One IR parameter.
#[derive(Debug, Clone, PartialEq)]
pub struct IrParam {
    /// Canonical/wire parameter name.
    pub name: String,
    /// Per-language public parameter names.
    pub names: IrLangNames,
    /// Required vs optional.
    pub required: bool,
    /// Type reference (may be Named for inline objects materialized as helpers).
    pub ty: IrTypeRef,
    /// Optional default JSON value.
    pub default_value: Option<serde_json::Value>,
    /// Documentation.
    pub doc: String,
}

/// Manifest-frozen error message templates for codegen.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct IrErrorTemplates {
    /// Webhook code → frozen message (sorted by code).
    pub webhook_messages: BTreeMap<String, String>,
    /// Paywall kind → frozen throw message.
    pub paywall_messages: BTreeMap<String, String>,
    /// MCP adapter-internal frozen messages (step 34).
    pub mcp_messages: BTreeMap<String, String>,
    /// Transport message template.
    pub transport_template: String,
    /// Per-operation default + case templates (sorted by operation id).
    pub operations: BTreeMap<String, IrOperationErrorTemplates>,
}

/// Error templates for one client operation.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct IrOperationErrorTemplates {
    /// Default HTTP-failure template.
    pub default_template: String,
    /// Case templates in manifest order.
    pub cases: Vec<String>,
}

/// How an overlay type should be emitted.
#[derive(Debug, Clone, PartialEq)]
pub enum IrOverlay {
    /// Struct (extendDto / mapDto / synthetic fields), possibly flattening a base.
    Struct(IrOverlayStruct),
    /// Closed string enum.
    StringEnum(IrStringEnum),
    /// Projected / synthetic union.
    OneOf(IrOneOf),
    /// `type Alias = Target` re-export (no new wire shape).
    Alias {
        /// Overlay type name.
        name: String,
        /// Existing IR / schemas type name.
        target: String,
        /// Doc comment body.
        doc: String,
    },
    /// `type Alias = Vec<Item>`.
    VecAlias {
        /// Overlay type name.
        name: String,
        /// Element type name.
        item: String,
        /// Doc comment body.
        doc: String,
    },
    /// Unit / void sentinel.
    Unit {
        /// Overlay type name.
        name: String,
        /// Doc comment body.
        doc: String,
    },
    /// Catalog-only marker (no Rust/TS type emission).
    Marker {
        /// Overlay name.
        name: String,
        /// Doc comment body.
        doc: String,
    },
}

/// Overlay struct with optional flattened OpenAPI/overlay base.
#[derive(Debug, Clone, PartialEq)]
pub struct IrOverlayStruct {
    /// Rust type name.
    pub name: String,
    /// Doc comment body.
    pub doc: String,
    /// When set, emit `#[serde(flatten)] base: BaseType` plus `fields`.
    pub flatten_base: Option<String>,
    /// When true with `flatten_base`, TS emits `Partial<Base> & { … }` (extendDto.partial).
    pub partial_base: bool,
    /// Additional / mapped fields.
    pub fields: Vec<IrField>,
}

/// A named DTO type in the IR.
#[derive(Debug, Clone, PartialEq)]
pub enum IrType {
    /// Object with named fields.
    Struct(IrStruct),
    /// Closed string enum.
    StringEnum(IrStringEnum),
    /// Discriminated or untagged union.
    OneOf(IrOneOf),
}

/// Object schema → Rust struct.
#[derive(Debug, Clone, PartialEq)]
pub struct IrStruct {
    /// Rust type name.
    pub name: String,
    /// Doc comment body (no `///` prefix).
    pub doc: String,
    /// Fields in declaration order (sorted by wire name for determinism).
    pub fields: Vec<IrField>,
}

/// One struct field.
#[derive(Debug, Clone, PartialEq)]
pub struct IrField {
    /// Wire JSON key (OpenAPI property name).
    pub wire_name: String,
    /// Rust field identifier (snake_case, keyword-safe).
    pub rust_name: String,
    /// Doc comment body.
    pub doc: String,
    /// Field type.
    pub ty: IrTypeRef,
    /// Whether the property appears in OpenAPI `required`.
    pub required: bool,
    /// Whether OpenAPI marks the property `nullable`.
    pub nullable: bool,
}

/// Closed string enumeration.
#[derive(Debug, Clone, PartialEq)]
pub struct IrStringEnum {
    /// Rust type name.
    pub name: String,
    /// Doc comment body.
    pub doc: String,
    /// Variants in sorted wire-value order.
    pub variants: Vec<IrEnumVariant>,
}

/// One string-enum variant.
#[derive(Debug, Clone, PartialEq)]
pub struct IrEnumVariant {
    /// Wire string value.
    pub wire: String,
    /// Rust variant identifier (PascalCase, keyword-safe).
    pub rust_name: String,
}

/// Strategy for emitting a `oneOf` union.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OneOfStrategy {
    /// Internally tagged on a unique discriminator property (`#[serde(tag = "...")]`).
    InternallyTagged,
    /// Untagged try-each variant (`#[serde(untagged)]`), variants ordered specific→general.
    Untagged,
    /// Special-case for `ProcessPaymentResult`: outer status tag + inner untagged succeeded arm.
    ProcessPaymentResult,
}

/// Discriminated / untagged union.
#[derive(Debug, Clone, PartialEq)]
pub struct IrOneOf {
    /// Rust type name.
    pub name: String,
    /// Doc comment body.
    pub doc: String,
    /// Emission strategy.
    pub strategy: OneOfStrategy,
    /// Discriminator property name when tagged.
    pub discriminator: Option<String>,
    /// Variants in emission order (order matters for untagged).
    pub variants: Vec<IrOneOfVariant>,
}

/// One `oneOf` branch.
#[derive(Debug, Clone, PartialEq)]
pub struct IrOneOfVariant {
    /// Rust variant name.
    pub rust_name: String,
    /// Wire discriminator value when tagged (e.g. `"card"`).
    pub tag_value: Option<String>,
    /// Payload type (usually a named struct).
    pub ty: IrTypeRef,
}

/// Reference to a type usable in field/position position.
#[derive(Debug, Clone, PartialEq)]
pub enum IrTypeRef {
    /// JSON string → `String`.
    String,
    /// JSON integer → `i64`.
    I64,
    /// JSON number → `f64`.
    F64,
    /// JSON boolean → `bool`.
    Bool,
    /// Free-form JSON → `serde_json::Value`.
    Value,
    /// Array → `Vec<T>`.
    Vec(Box<IrTypeRef>),
    /// String-keyed map → `BTreeMap<String, T>` (or `Map` via serde_json for Value values).
    Map(Box<IrTypeRef>),
    /// Named IR type.
    Named(String),
    /// String literal type (e.g. `'balance'`).
    LiteralString(String),
    /// Boolean literal type (e.g. `true`).
    LiteralBool(bool),
}

/// One HTTP operation's wire contract.
#[derive(Debug, Clone, PartialEq)]
pub struct IrRoute {
    /// Uppercase HTTP method.
    pub method: String,
    /// Templated path (e.g. `/v1/sdk/customers/{reference}`).
    pub path_template: String,
    /// OpenAPI `operationId`.
    pub operation_id: String,
    /// OpenAPI operation `description` (preferred doc fallback).
    pub description: Option<String>,
    /// OpenAPI operation `summary` (secondary doc fallback).
    pub summary: Option<String>,
    /// JSON request body type, when present.
    pub request_body: Option<IrTypeRef>,
    /// Preferred 2xx JSON response body type, when present.
    pub response_body: Option<IrTypeRef>,
}
