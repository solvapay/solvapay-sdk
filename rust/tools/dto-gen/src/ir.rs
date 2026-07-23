//! Typed intermediate representation for OpenAPI wire models + SDK overlays.
//!
//! Emitters consume only this IR (§5.6). Building the IR from the same snapshot
//! must be deterministic (sorted maps / stable iteration).

use std::collections::BTreeMap;

/// Complete IR produced from one OpenAPI snapshot (+ optional manifest overlays).
#[derive(Debug, Clone, PartialEq)]
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
}

/// Sync availability for TypeScript (step 18 emitters).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IrSyncKind {
    /// Returns a Promise / async function.
    Async,
    /// Synchronous function.
    Sync,
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
}

impl Default for IrDefaults {
    fn default() -> Self {
        Self {
            max_retries: 2,
            initial_delay_ms: 500,
            webhook_tolerance_sec: 300,
            limits_cache_ttl_ms: 10_000,
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
    /// JSON request body type, when present.
    pub request_body: Option<IrTypeRef>,
    /// Preferred 2xx JSON response body type, when present.
    pub response_body: Option<IrTypeRef>,
}
