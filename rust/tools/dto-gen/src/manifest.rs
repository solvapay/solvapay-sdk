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
}

/// Per-operation manifest entry.
#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct OperationDef {
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
}
