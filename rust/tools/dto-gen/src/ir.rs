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
    /// TypeScript sync kind.
    pub sync_ts: IrSyncKind,
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
    /// Parameter name.
    pub name: String,
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
