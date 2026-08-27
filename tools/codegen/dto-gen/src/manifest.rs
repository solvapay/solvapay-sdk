//! Manifest YAML types for SDK-only overlays, error templates, and catalog.

use std::collections::BTreeMap;

use serde::Deserialize;

/// Top-level SDK contract manifest.
#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct Manifest {
    /// Client operations.
    #[serde(default)]
    pub operations: BTreeMap<String, OperationDef>,
    /// Overlay catalog keyed by overlay name.
    #[serde(default)]
    pub overlays: BTreeMap<String, OverlayDef>,
    /// Frozen cross-language error message templates (§4.4 / step 17).
    #[serde(default)]
    pub errors: Option<ErrorsBlock>,
    /// Top-level helpers / error classes.
    #[serde(default, rename = "topLevel")]
    pub top_level: BTreeMap<String, NamedEntry>,
    /// `@solvapay/core` helpers.
    #[serde(default, rename = "coreHelpers")]
    pub core_helpers: BTreeMap<String, NamedEntry>,
    /// Facade factory / payable surface.
    #[serde(default)]
    pub facade: BTreeMap<String, NamedEntry>,
    /// TS-only residue for the core boundary-type emitter (Phase 3a).
    #[serde(default, rename = "boundaryTypesTs")]
    pub boundary_types_ts: BoundaryTypesTsDef,
    /// Manifest-frozen runtime defaults used by every language facade.
    #[serde(default)]
    pub defaults: DefaultsDef,
}

/// TS overlay for core boundary types (`boundaryTypesTs:`).
#[derive(Debug, Clone, Deserialize, PartialEq, Default)]
pub struct BoundaryTypesTsDef {
    /// Rust type names not emitted under their own name.
    #[serde(default)]
    pub omit: Vec<String>,
    /// Extra TS names copied from a Rust type.
    #[serde(default)]
    pub aliases: BTreeMap<String, BoundaryTypesTsAliasDef>,
    /// Rust type name → public TS type name.
    #[serde(default)]
    pub rename: BTreeMap<String, String>,
    /// Public TS type name → verbatim type RHS.
    #[serde(default)]
    pub reshape: BTreeMap<String, String>,
    /// Extra TS types with no Rust counterpart.
    #[serde(default)]
    pub extra: BTreeMap<String, String>,
}

/// One `boundaryTypesTs.aliases` entry.
#[derive(Debug, Clone, Deserialize, PartialEq, Default)]
pub struct BoundaryTypesTsAliasDef {
    /// Rust type this alias copies.
    pub of: String,
    /// Wire field names to drop from the alias body.
    #[serde(default, rename = "omitFields")]
    pub omit_fields: Vec<String>,
}

/// Runtime defaults frozen by `sdk-contract.yaml`.
#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct DefaultsDef {
    /// Retry policy defaults.
    #[serde(default)]
    pub retry: RetryDefaultsDef,
    /// Webhook timestamp tolerance in seconds.
    #[serde(default = "default_webhook_tolerance", rename = "webhookToleranceSec")]
    pub webhook_tolerance_sec: i64,
    /// Limits cache TTL in milliseconds.
    #[serde(default = "default_limits_cache_ttl", rename = "limitsCacheTTLMs")]
    pub limits_cache_ttl_ms: u64,
}

impl Default for DefaultsDef {
    fn default() -> Self {
        Self {
            retry: RetryDefaultsDef::default(),
            webhook_tolerance_sec: default_webhook_tolerance(),
            limits_cache_ttl_ms: default_limits_cache_ttl(),
        }
    }
}

/// Retry defaults frozen by the manifest.
#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct RetryDefaultsDef {
    /// Retry attempts after the initial call.
    #[serde(default = "default_max_retries", rename = "maxRetries")]
    pub max_retries: u32,
    /// Initial delay in milliseconds.
    #[serde(default = "default_initial_delay", rename = "initialDelayMs")]
    pub initial_delay_ms: u64,
}

impl Default for RetryDefaultsDef {
    fn default() -> Self {
        Self {
            max_retries: default_max_retries(),
            initial_delay_ms: default_initial_delay(),
        }
    }
}

const fn default_max_retries() -> u32 {
    2
}

const fn default_initial_delay() -> u64 {
    500
}

const fn default_webhook_tolerance() -> i64 {
    300
}

const fn default_limits_cache_ttl() -> u64 {
    10_000
}

/// `tsWrapper:` residue on a binding symbol (Phase 3c).
#[derive(Debug, Clone, Deserialize, PartialEq, Default)]
pub struct BindingTsWrapperDef {
    /// Export name when it differs from `names.ts`.
    #[serde(default, rename = "exportName")]
    pub export_name: Option<String>,
    /// Generic clause including angle brackets.
    #[serde(default)]
    pub generics: Option<String>,
    /// Override for the TS return type.
    #[serde(default, rename = "returnType")]
    pub return_type: Option<String>,
    /// Per-parameter TS type overrides.
    #[serde(default, rename = "paramTypes")]
    pub param_types: BTreeMap<String, String>,
    /// Function-level optional-param style.
    #[serde(default, rename = "optionalStyle")]
    pub optional_style: Option<String>,
    /// Per-parameter optional style overrides.
    #[serde(default, rename = "paramStyle")]
    pub param_style: BTreeMap<String, String>,
    /// Force pass-through of the first TS argument to `dispatchSync`.
    #[serde(default, rename = "passThrough")]
    pub pass_through: bool,
    /// Treat the TS surface as a single object parameter.
    #[serde(default, rename = "objectParam")]
    pub object_param: bool,
    /// Post-process the dispatch result (`nullToUndefined`).
    #[serde(default, rename = "postProcess")]
    pub post_process: Option<String>,
    /// Verbatim object-literal fields passed to `dispatchSync`.
    #[serde(default, rename = "dispatchArgs")]
    pub dispatch_args: Option<String>,
    /// JSDoc body (no `/**` wrapper) for the core wrapper.
    #[serde(default)]
    pub doc: Option<String>,
    /// Inner comment emitted only on the server wrapper.
    #[serde(default, rename = "serverComment")]
    pub server_comment: Option<String>,
    /// Verbatim parameter list including the closing return type.
    #[serde(default)]
    pub signature: Option<String>,
}

/// Shim-emission residue keyed by binding id (`binding-residue.yaml`).
#[derive(Debug, Clone, Deserialize, PartialEq, Default)]
pub struct BindingResidueDef {
    /// TypeScript dispatch-wrapper residue.
    #[serde(default, rename = "tsWrapper")]
    pub ts_wrapper: Option<BindingTsWrapperDef>,
    /// Verbatim shim body (Node).
    #[serde(default, rename = "verbatimBody")]
    pub verbatim_body: Option<String>,
    /// Verbatim shim body override for Wasm.
    #[serde(default, rename = "verbatimBodyWasm")]
    pub verbatim_body_wasm: Option<String>,
    /// Client DTO parsed from args JSON.
    #[serde(default, rename = "dtoType")]
    pub dto_type: Option<String>,
    /// Client method call args for `clientSplit`.
    #[serde(default, rename = "clientCallArgs")]
    pub client_call_args: Vec<String>,
    /// Doc override when it is not `Binding for \`id\`.`
    #[serde(default)]
    pub doc: Option<String>,
    /// Wasm doc override.
    #[serde(default, rename = "docWasm")]
    pub doc_wasm: Option<String>,
    /// Path-ref split keys (client symbols).
    #[serde(default, rename = "splitPathRefs")]
    pub split_path_refs: Vec<String>,
    /// Full JSON-args override (`[]` means no JSON args). Absent → derive from signature.
    #[serde(default)]
    pub args: Option<Vec<BindingArgDef>>,
    /// When true, omit `coreCall` (verbatim YAML often left it unset).
    #[serde(default, rename = "omitCoreCall")]
    pub omit_core_call: bool,
    /// Wrap `call.args` tokens when they are not derivable from refness.
    #[serde(default, rename = "callArgs")]
    pub call_args: Option<Vec<String>>,
}

/// Root of `binding-residue.yaml`: symbol id → residue.
pub type BindingResidueManifest = BTreeMap<String, BindingResidueDef>;

/// One ordered JSON-arg on a binding symbol.
#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct BindingArgDef {
    /// Arg key.
    pub name: String,
    /// Boundary type (`string`, `string?`, `f64`, …).
    #[serde(rename = "type")]
    pub ty: String,
    /// Required vs optional.
    #[serde(default = "default_true")]
    pub required: bool,
    /// Host-injected flag.
    #[serde(default, rename = "hostInjected")]
    pub host_injected: bool,
    /// Exact `args.rs` extractor helper (defaults from `(type, required)`).
    #[serde(default)]
    pub extract: Option<String>,
    /// Turbofish / annotation type for `requireTyped` / `optionalTyped`.
    #[serde(default, rename = "typedAs")]
    pub typed_as: Option<String>,
    /// Rendering style for typed extracts (`turbofish` default | `annotation`).
    #[serde(default, rename = "typedStyle")]
    pub typed_style: Option<String>,
    /// Local binding name (defaults to snake_case of `name`).
    #[serde(default)]
    pub local: Option<String>,
}

/// Per-language idiomatic names (§5.6).
#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct LangNames {
    /// TypeScript name.
    pub ts: String,
    /// Python name.
    pub py: String,
    /// Ruby name.
    pub rb: String,
    /// Go name.
    pub go: String,
    /// Rust name.
    pub rust: String,
    /// C ABI name (dispatch key). Optional in tests; empty defaults to `ts`.
    #[serde(default)]
    pub c: String,
}

/// Generic type parameter (`withRetry<T>`).
#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct TypeParam {
    /// Type parameter name (e.g. `T`).
    pub name: String,
}

/// One positional / options-bag parameter (§5.6 / step 18).
#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct ParamDef {
    /// Parameter name.
    pub name: String,
    /// Required vs optional (`?` in TS).
    #[serde(default = "default_true")]
    pub required: bool,
    /// Optional default value.
    #[serde(default, rename = "default")]
    pub default_value: Option<serde_json::Value>,
    /// Parameter documentation.
    #[serde(default)]
    pub doc: Option<String>,
    /// Primitive type name when not using ref/array/map/enum/literal/object.
    #[serde(default, rename = "type")]
    pub ty: Option<String>,
    /// Named type reference (`ref` in YAML).
    #[serde(default, rename = "ref")]
    pub ref_name: Option<String>,
    /// Array element type.
    #[serde(default)]
    pub array: Option<Box<FieldDef>>,
    /// Map value type.
    #[serde(default)]
    pub map: Option<Box<FieldDef>>,
    /// Closed string enum.
    #[serde(default, rename = "enum")]
    pub enum_variants: Option<Vec<String>>,
    /// Literal value.
    #[serde(default)]
    pub literal: Option<serde_json::Value>,
    /// Inline object fields.
    #[serde(default)]
    pub object: Option<BTreeMap<String, FieldDef>>,
}

fn default_true() -> bool {
    true
}

impl ParamDef {
    /// View as a [`FieldDef`] for shared type lowering.
    pub fn as_field_def(&self) -> FieldDef {
        FieldDef {
            ty: self.ty.clone(),
            ref_name: self.ref_name.clone(),
            array: self.array.clone(),
            map: self.map.clone(),
            enum_variants: self.enum_variants.clone(),
            literal: self.literal.clone(),
            object: self.object.clone(),
            required: self.required,
            nullable: false,
            doc: self.doc.clone(),
        }
    }
}

/// Language-neutral docs authored once in the manifest (§5.6 / D19 / step 18T).
///
/// Per-parameter descriptions may also appear on [`ParamDef::doc`]; when both
/// exist, `docs.params.<name>` wins during IR lowering.
#[derive(Debug, Clone, Deserialize, PartialEq, Default)]
pub struct DocsDef {
    /// One-line summary. Manifest wins; for routed operations an empty/absent
    /// summary falls back to the OpenAPI operation `description` / `summary`.
    #[serde(default)]
    pub summary: Option<String>,
    /// Parameter name → description overlay.
    #[serde(default)]
    pub params: BTreeMap<String, String>,
    /// Optional return-value description.
    #[serde(default)]
    pub returns: Option<String>,
}

/// Named catalog entry (topLevel / coreHelpers / facade).
#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct NamedEntry {
    /// Per-language names.
    pub names: LangNames,
    /// Sync matrix (flexible JSON — emitters read `ts`).
    #[serde(default)]
    pub sync: serde_json::Value,
    /// Parameter list.
    #[serde(default)]
    pub params: Vec<ParamDef>,
    /// Generic type parameters.
    #[serde(default, rename = "typeParams")]
    pub type_params: Vec<TypeParam>,
    /// Shared doc model for this entry point.
    #[serde(default)]
    pub docs: DocsDef,
}

/// Per-operation manifest entry.
#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct OperationDef {
    /// HTTP route for this wire operation.
    #[serde(default)]
    pub route: Option<OperationRoute>,
    /// Per-language names.
    #[serde(default)]
    pub names: Option<LangNames>,
    /// When true, method is optional on `SolvaPayClient`.
    #[serde(default, rename = "optionalOnClient")]
    pub optional_on_client: bool,
    /// Request DTO / overlay name.
    #[serde(default)]
    pub request: Option<String>,
    /// Response DTO / overlay name.
    #[serde(default)]
    pub response: Option<String>,
    /// Positional parameter list.
    #[serde(default)]
    pub params: Vec<ParamDef>,
    /// Sync matrix.
    #[serde(default)]
    pub sync: serde_json::Value,
    /// Error templates for this operation.
    pub errors: OperationErrors,
    /// Shared doc model for this entry point.
    #[serde(default)]
    pub docs: DocsDef,
}

/// HTTP method + path for a catalogued wire operation.
#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct OperationRoute {
    /// Uppercase HTTP method (`GET`, `POST`, …).
    pub method: String,
    /// Templated path (e.g. `/v1/sdk/limits`).
    pub path: String,
}

/// Operation-level default + case error templates.
#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct OperationErrors {
    /// Default HTTP-failure message template.
    pub default: MessageTemplate,
    /// Status- or shape-specific cases.
    #[serde(default)]
    pub cases: Vec<ErrorCase>,
}

/// One message template object (`messageTemplate: "..."`).
#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct MessageTemplate {
    /// Template string with `{placeholder}` slots.
    #[serde(rename = "messageTemplate")]
    pub message_template: String,
}

/// One operation error case (optional status/code).
#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct ErrorCase {
    /// Template string with `{placeholder}` slots.
    #[serde(rename = "messageTemplate")]
    pub message_template: String,
    /// Optional HTTP status scoping this case.
    #[serde(default)]
    pub status: Option<u16>,
    /// Optional free-form code.
    #[serde(default)]
    pub code: Option<String>,
}

/// Top-level `errors:` block (webhook / paywall / mcp / transport).
#[derive(Debug, Clone, Deserialize, PartialEq, Default)]
pub struct ErrorsBlock {
    /// Webhook verification codes + frozen messages.
    pub webhook: WebhookErrors,
    /// Paywall throw messages.
    pub paywall: PaywallErrors,
    /// MCP adapter-internal frozen messages (step 34).
    #[serde(default)]
    pub mcp: McpErrors,
    /// Transport message template placeholder (step 21).
    pub transport: TransportErrors,
}

/// Webhook error codes and frozen messages.
#[derive(Debug, Clone, Deserialize, PartialEq, Default)]
pub struct WebhookErrors {
    /// Stable code list.
    #[serde(default)]
    pub codes: Vec<String>,
    /// Code → frozen human-readable message.
    #[serde(default)]
    pub messages: BTreeMap<String, String>,
}

/// Paywall throw-message catalog.
#[derive(Debug, Clone, Deserialize, PartialEq, Default)]
pub struct PaywallErrors {
    /// Kind → frozen throw message (`payment_required` / `activation_required`).
    #[serde(default)]
    pub messages: BTreeMap<String, String>,
}

/// MCP adapter-internal frozen messages (step 34).
#[derive(Debug, Clone, Deserialize, PartialEq, Default)]
pub struct McpErrors {
    /// Message key → frozen merchant-actionable string.
    #[serde(default)]
    pub messages: BTreeMap<String, String>,
}

/// Transport template placeholder.
#[derive(Debug, Clone, Deserialize, PartialEq, Default)]
pub struct TransportErrors {
    /// Template used when constructing transport failures.
    #[serde(default, rename = "messageTemplate")]
    pub message_template: String,
}

/// Discriminated overlay definition from `sdk-contract.yaml`.
#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(tag = "kind")]
pub enum OverlayDef {
    /// Extend an OpenAPI / overlay DTO with extra fields.
    #[serde(rename = "extendDto")]
    ExtendDto {
        /// Base type name.
        base: String,
        /// Optional documentation.
        #[serde(default)]
        doc: Option<String>,
        /// When true, inherited base fields are treated as optional (not copied).
        #[serde(default)]
        partial: bool,
        /// Additional fields.
        #[serde(default)]
        fields: BTreeMap<String, FieldDef>,
    },
    /// Mapped / normalized DTO shape.
    #[serde(rename = "mapDto")]
    MapDto {
        /// Optional base type name.
        #[serde(default)]
        base: Option<String>,
        /// Optional documentation.
        #[serde(default)]
        doc: Option<String>,
        /// Wire → SDK renames (informational for emitters / docs).
        #[serde(default)]
        renames: BTreeMap<String, String>,
        /// Full projected field set.
        fields: BTreeMap<String, FieldDef>,
    },
    /// Projection of a union type.
    #[serde(rename = "projectUnion")]
    ProjectUnion {
        /// Base union type name.
        base: String,
        /// Optional documentation.
        #[serde(default)]
        doc: Option<String>,
        /// Variant names to drop.
        #[serde(default, rename = "dropVariants")]
        drop_variants: Vec<String>,
        /// Extra fields on the bare succeeded arm.
        #[serde(default, rename = "succeededFields")]
        succeeded_fields: BTreeMap<String, FieldDef>,
    },
    /// Fully synthetic SDK type / alias / marker.
    #[serde(rename = "synthetic")]
    Synthetic {
        /// Optional documentation.
        #[serde(default)]
        doc: Option<String>,
        /// Unit / void sentinel.
        #[serde(default)]
        unit: bool,
        /// Catalog-only marker.
        #[serde(default)]
        marker: bool,
        /// Re-export existing IR type.
        #[serde(default, rename = "aliasOf")]
        alias_of: Option<String>,
        /// `Vec<item>` alias.
        #[serde(default, rename = "arrayOf")]
        array_of: Option<String>,
        /// Closed string enum variants.
        #[serde(default, rename = "enum")]
        enum_variants: Option<Vec<String>>,
        /// Struct fields.
        #[serde(default)]
        fields: BTreeMap<String, FieldDef>,
    },
}

/// One overlay field definition (type + flags).
#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct FieldDef {
    /// Primitive type name when not using ref/array/map/enum/literal/object.
    #[serde(default, rename = "type")]
    pub ty: Option<String>,
    /// Named type reference (`ref` in YAML).
    #[serde(default, rename = "ref")]
    pub ref_name: Option<String>,
    /// Array element type.
    #[serde(default)]
    pub array: Option<Box<FieldDef>>,
    /// Map value type.
    #[serde(default)]
    pub map: Option<Box<FieldDef>>,
    /// Closed string enum.
    #[serde(default, rename = "enum")]
    pub enum_variants: Option<Vec<String>>,
    /// Literal value (emitted as string/number/bool type).
    #[serde(default)]
    pub literal: Option<serde_json::Value>,
    /// Inline object fields.
    #[serde(default)]
    pub object: Option<BTreeMap<String, FieldDef>>,
    /// Required flag.
    #[serde(default)]
    pub required: bool,
    /// Nullable flag.
    #[serde(default)]
    pub nullable: bool,
    /// Field documentation.
    #[serde(default)]
    pub doc: Option<String>,
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
mod tests {
    use super::*;

    #[test]
    fn deserializes_operation_catalog_fields() {
        let yaml = r#"
operations:
  updateCustomer:
    names:
      ts: updateCustomer
      py: update_customer
      rb: update_customer
      go: UpdateCustomer
      rust: update_customer
    optionalOnClient: true
    request: UpdateCustomerRequest
    response: UpdateCustomerResult
    params:
      - name: customerRef
        type: string
        required: true
      - name: params
        ref: UpdateCustomerParams
        required: true
    sync:
      ts: async
      py: [async, blocking]
      rb: blocking
      go: blocking
      rust: [async, blocking]
    errors:
      default:
        messageTemplate: "Update customer failed ({status}): {body}"
"#;
        let manifest: Manifest = serde_norway::from_str(yaml).unwrap();
        let op = manifest.operations.get("updateCustomer").unwrap();
        assert_eq!(op.names.as_ref().unwrap().ts, "updateCustomer");
        assert!(op.optional_on_client);
        assert_eq!(op.params.len(), 2);
        assert_eq!(op.params[0].name, "customerRef");
        assert_eq!(op.params[1].name, "params");
    }

    #[test]
    fn deserializes_with_retry_type_params() {
        let yaml = r#"
topLevel:
  withRetry:
    names:
      ts: withRetry
      py: with_retry
      rb: with_retry
      go: WithRetry
      rust: with_retry
    sync:
      ts: sync
      py: sync
      rb: sync
      go: sync
      rust: sync
    typeParams:
      - name: T
    params:
      - name: fn
        type: unknown
        required: true
      - name: options
        ref: RetryOptions
        required: false
"#;
        let manifest: Manifest = serde_norway::from_str(yaml).unwrap();
        let entry = manifest.top_level.get("withRetry").unwrap();
        assert_eq!(entry.type_params.len(), 1);
        assert_eq!(entry.type_params[0].name, "T");
        assert_eq!(entry.params.len(), 2);
    }

    #[test]
    fn deserializes_docs_block_on_operation_and_named_entry() {
        let yaml = r#"
operations:
  checkLimits:
    names:
      ts: checkLimits
      py: check_limits
      rb: check_limits
      go: CheckLimits
      rust: check_limits
    response: LimitResponseWithPlan
    params:
      - name: params
        ref: CheckLimitsRequest
        required: true
    docs:
      summary: "Check remaining usage/spend limits for a customer against a product's plan."
      params:
        params: "Limits request including customer and product refs."
      returns: "Current remaining limits, optionally including plan details."
    sync:
      ts: async
      py: [async, blocking]
      rb: blocking
      go: blocking
      rust: [async, blocking]
    errors:
      default:
        messageTemplate: "Check limits failed ({status}): {body}"
topLevel:
  withRetry:
    names:
      ts: withRetry
      py: with_retry
      rb: with_retry
      go: WithRetry
      rust: with_retry
    sync:
      ts: sync
      py: sync
      rb: sync
      go: sync
      rust: sync
    docs:
      summary: "Retry an async callable with the frozen default backoff policy."
      params:
        fn: "Zero-arg async callable to invoke."
        options: "Optional retry overrides."
      returns: "The callable's resolved value."
"#;
        let manifest: Manifest = serde_norway::from_str(yaml).unwrap();
        let op = manifest.operations.get("checkLimits").unwrap();
        assert_eq!(
            op.docs.summary.as_deref(),
            Some("Check remaining usage/spend limits for a customer against a product's plan.")
        );
        assert_eq!(
            op.docs.params.get("params").map(String::as_str),
            Some("Limits request including customer and product refs.")
        );
        assert_eq!(
            op.docs.returns.as_deref(),
            Some("Current remaining limits, optionally including plan details.")
        );
        let entry = manifest.top_level.get("withRetry").unwrap();
        assert_eq!(
            entry.docs.summary.as_deref(),
            Some("Retry an async callable with the frozen default backoff policy.")
        );
        assert_eq!(
            entry.docs.params.get("fn").map(String::as_str),
            Some("Zero-arg async callable to invoke.")
        );
        assert_eq!(
            entry.docs.returns.as_deref(),
            Some("The callable's resolved value.")
        );
    }
}
