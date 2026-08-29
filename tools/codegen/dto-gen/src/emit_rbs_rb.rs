//! Emit the public Ruby RBS surface from canonical catalog IR.

use std::fmt::Write as _;

use crate::error::GenResult;
use crate::header::{generated_header, CommentStyle};
use crate::ir::{
    Ir, IrBindingArg, IrBindingCatalogLink, IrBindingSymbol, IrBoundaryType, IrEntryPoint,
    IrRubyReceiver, IrTypeRef,
};

/// Emits `sig/solvapay.rbs`.
///
/// # Errors
///
/// Returns formatting failures as [`crate::error::GenError`].
pub fn emit_rbs_rb(ir: &Ir) -> GenResult<String> {
    let mut output = format!("{}\n", generated_header(CommentStyle::Hash, "rb-rbs-out"));
    output.push_str(
        "module SolvaPay\n\
         \x20 VERSION: String\n\
         \x20 CUSTOMER_CACHE_TTL_MS: Integer\n\
         \x20 CUSTOMER_DEDUP_MAX_CACHE_SIZE: Integer\n\
         \x20 ANONYMOUS_CUSTOMER_REF: String\n\
         \x20 REQUEST_ID_FORMAT: String\n\
         \x20 USAGE_ACTION_TYPE: String\n\
         \x20 DEFAULT_LIMITS_CACHE_TTL_MS: Integer\n\
         \x20 TOPUP_BALANCE_POLL_DELAYS_MS: Array[Integer]\n\
         \x20 BALANCE_RECONCILE_DELAYS_MS: Array[Integer]\n\
         \x20 Error: singleton(SolvaPayError)\n\n\
         \x20 # Private Magnus extension module (runtime-only).\n\
         \x20 module Native\n\
         \x20   def self.version: () -> String?\n\
         \x20   def self.verify_webhook: (String, String, String) -> String\n\
         \x20   def self._verify_webhook_at: (String, String, String, Integer) -> String\n\
         \x20   class Client\n\
         \x20     def initialize: (String api_key, String? api_base_url) -> void\n\
         \x20     def public_send: (String | Symbol name, *untyped) -> untyped\n\
         \x20   end\n\
         \x20 end\n\n\
         \x20 # Envelope dispatch bridge used by the generated public facade.\n\
         \x20 module NativeDispatch\n\
         \x20   CLIENT_METHODS: Array[String]\n\
         \x20   SYNC_METHODS: Array[String]\n\
         \x20   RAW_VERIFY_WEBHOOK: untyped\n\
         \x20   RAW_VERIFY_WEBHOOK_AT: untyped\n\n\
         \x20   def self.native_module: () -> untyped\n\
         \x20   def self.build_client: (api_key: String?, ?api_base_url: String?) -> untyped\n\
         \x20   def self.call_client: (untyped client, String name, Hash[String, untyped] args) -> untyped\n\
         \x20   def self.call_sync: (String name, Hash[String, untyped] args) -> untyped\n\
         \x20   def self.verify_webhook: (body: String, signature: String, secret: String) -> Hash[String, untyped]\n\
         \x20   def self.verify_webhook_at: (body: String, signature: String, secret: String, now_unix_secs: Integer) -> Hash[String, untyped]\n\
         \x20   def self.unwrap: (String envelope_json) -> untyped\n\
         \x20   def self.reconstruct_error: (Hash[String, untyped] error) -> SolvaPayError\n\n\
         \x20   def native_module: () -> untyped\n\
         \x20   def build_client: (api_key: String?, ?api_base_url: String?) -> untyped\n\
         \x20   def call_client: (untyped client, String name, Hash[String, untyped] args) -> untyped\n\
         \x20   def call_sync: (String name, Hash[String, untyped] args) -> untyped\n\
         \x20   def verify_webhook: (body: String, signature: String, secret: String) -> Hash[String, untyped]\n\
         \x20   def verify_webhook_at: (body: String, signature: String, secret: String, now_unix_secs: Integer) -> Hash[String, untyped]\n\
         \x20   def unwrap: (String envelope_json) -> untyped\n\
         \x20   def reconstruct_error: (Hash[String, untyped] error) -> SolvaPayError\n\
         \x20 end\n\n\
         \x20 class SolvaPayError < StandardError\n\
         \x20   attr_reader code: String?\n\
         \x20   attr_reader status: Integer?\n\
         \x20   attr_reader kind: String?\n\
         \x20   attr_reader retryable: bool?\n\
         \x20   def initialize: (String message, ?code: String?, ?status: Integer?, ?kind: String?, ?retryable: bool?) -> void\n\
         \x20 end\n\n\
         \x20 class PaywallError < SolvaPayError\n\
         \x20   attr_reader structured_content: Hash[String, untyped]\n\
         \x20   def initialize: (String message, ?Hash[String, untyped] structured_content) -> void\n\
         \x20 end\n\n\
         \x20 class PayablePaywallResult\n\
         \x20   attr_reader kind: String\n\
         \x20   attr_reader content: Hash[String, untyped]\n\
         \x20   def initialize: (content: Hash[String, untyped]) -> void\n\
         \x20 end\n\n\
         \x20 class PayableAllowResult\n\
         \x20   attr_reader kind: String\n\
         \x20   attr_reader customer_ref: String\n\
         \x20   attr_reader decision: Hash[String, untyped]\n\
         \x20   def initialize: (customer_ref: String, decision: Hash[String, untyped], track_success: untyped, track_fail: untyped) -> void\n\
         \x20   def track_success: (?duration: Numeric?, ?metadata: Hash[String, untyped]?) -> void\n\
         \x20   def track_fail: (untyped error, ?duration: Numeric?, ?metadata: Hash[String, untyped]?) -> void\n\
         \x20 end\n\n\
         \x20 type gate_result = PayableAllowResult | PayablePaywallResult\n\n\
         \x20 class Client\n\
         \x20   @native_client: untyped\n\
         \x20   def initialize: (?api_key: String?, ?api_base_url: String?, ?native_client: untyped) -> void\n",
    );
    let mut operations: Vec<_> = ir
        .entry_points
        .values()
        .filter(|entry| entry.ruby_target.receiver == IrRubyReceiver::ClientInstance)
        .collect();
    operations.sort_by(|left, right| left.ruby_target.name.cmp(&right.ruby_target.name));
    for entry in operations {
        let _ = writeln!(
            output,
            "    def {}: {} -> untyped",
            entry.ruby_target.name,
            rbs_params(entry, true)
        );
    }
    output.push_str(
        "  end\n\n\
         \x20 class Facade\n\
         \x20   BASE36: String\n\
         \x20   @client: Client\n\
         \x20   @limits_cache_ttl: Integer\n\
         \x20   @clock: ^() -> Integer\n\
         \x20   @mutex: Thread::Mutex\n\
         \x20   @customer_cache: Hash[String, untyped]\n\
         \x20   @customer_inflight: Hash[String, untyped]\n\
         \x20   @limits_cache: Hash[String, untyped]\n\
         \x20   def initialize: (?api_key: String?, ?api_base_url: String?, ?limits_cache_ttl: Integer, ?api_client: Client?, ?clock: ^() -> Integer) -> void\n\
         \x20   def gate: (String customer_ref, product: String, ?usage_type: String) -> gate_result\n\
         \x20   def payable: (product: String, ?usage_type: String) -> Payable\n\
         \x20   private\n\
         \x20   def evaluate_limits: (String key, customer_ref: String, product: String, usage_type: String) -> [bool, Numeric, Hash[String, untyped]?]\n\
         \x20   def ensure_customer: (String customer_ref) -> String\n\
         \x20   def acquire_customer_lookup: (String customer_ref) -> [Hash[Symbol, untyped], bool]\n\
         \x20   def await_customer_lookup: (Hash[Symbol, untyped] state) -> String\n\
         \x20   def publish_customer_lookup: (String customer_ref, Hash[Symbol, untyped] state, ?result: String?, ?error: Exception?) -> void\n\
         \x20   def run_ensure_customer: (String customer_ref) -> String\n\
         \x20   def write_customer_cache: (String key, String backend_ref, untyped timestamp_ms) -> void\n\
         \x20   def paywall_short_message: (untyped content) -> String\n\
         \x20   def build_allow_result: (backend_ref: String, decision: Hash[String, untyped], driver_state: untyped) -> PayableAllowResult\n\
         \x20   def apply_gate_cache: (untyped cache) -> void\n\
         \x20   def random_unit: () -> Numeric\n\
         \x20   def post_usage_request: (Hash[String, untyped] request) -> untyped\n\
         \x20   def emit_handler_usage: (untyped state, Hash[String, untyped] event) -> void\n\
         \x20 end\n\n\
         \x20 class Payable\n\
         \x20   @facade: Facade\n\
         \x20   @product: String\n\
         \x20   @usage_type: String\n\
         \x20   def initialize: (Facade facade, product: String, usage_type: String) -> void\n\
         \x20   def protect: () { (*untyped, **untyped) -> untyped } -> Proc\n\
         \x20 end\n\n\
         \x20 def self.create: (?api_key: String?, ?api_base_url: String?, ?limits_cache_ttl: Integer, ?api_client: Client?, ?clock: ^() -> Integer) -> Facade\n\
         \x20 def create: (?api_key: String?, ?api_base_url: String?, ?limits_cache_ttl: Integer, ?api_client: Client?, ?clock: ^() -> Integer) -> Facade\n\
         \x20 def self.verify_webhook: (body: String, signature: String, secret: String) -> Hash[String, untyped]\n\
         \x20 def verify_webhook: (body: String, signature: String, secret: String) -> Hash[String, untyped]\n\
         \x20 def self.with_retry: [T] (?max_retries: Integer, ?initial_delay: Integer, ?backoff_strategy: String, ?should_retry: (^(untyped, Integer) -> bool)?, ?on_retry: (^(untyped, Integer, Numeric) -> void)?, ?sleeper: ^(Float | Integer) -> void) { () -> T } -> T\n\
         \x20 def with_retry: [T] (?max_retries: Integer, ?initial_delay: Integer, ?backoff_strategy: String, ?should_retry: (^(untyped, Integer) -> bool)?, ?on_retry: (^(untyped, Integer, Numeric) -> void)?, ?sleeper: ^(Float | Integer) -> void) { () -> T } -> T\n\
         \x20 def self.version: () -> String?\n\
         \x20 def self._check_version_skew: () -> void\n\
         \x20 def _check_version_skew: () -> void\n\
         \x20 def self._verify_webhook_at: (String, String, String, Integer) -> String\n",
    );

    // Constant helpers emitted as `NAME = …` in helpers.generated.rb.
    let mut constants: Vec<_> = ir
        .entry_points
        .values()
        .filter(|entry| entry.ruby_target.receiver == IrRubyReceiver::Constant)
        .collect();
    constants.sort_by(|left, right| left.ruby_target.name.cmp(&right.ruby_target.name));
    for entry in constants {
        let _ = writeln!(output, "  {}: untyped", entry.ruby_target.name);
    }

    let helper_bindings = helper_bindings(ir);
    let mut helpers: Vec<_> = ir
        .entry_points
        .values()
        .filter(|entry| entry.ruby_target.receiver == IrRubyReceiver::ModuleFunction)
        .filter(|entry| {
            !matches!(
                entry.ruby_target.name.as_str(),
                "create" | "verify_webhook" | "with_retry"
            )
        })
        .collect();
    helpers.sort_by(|left, right| left.ruby_target.name.cmp(&right.ruby_target.name));
    for entry in helpers {
        let params = helper_rbs_params(entry, helper_bindings.get(entry.id.as_str()).copied());
        let _ = writeln!(
            output,
            "  def self.{}: {params} -> untyped",
            entry.ruby_target.name
        );
    }
    output.push_str("end\n");
    Ok(output)
}

/// Emits `sdks/ruby-mcp/sig/layer2.generated.rbs` (`SolvaPay::Mcp::Layer2`).
///
/// MCP types live in the ruby-mcp gem, not the core `solvapay` RBS.
///
/// # Errors
///
/// Returns formatting failures as [`crate::error::GenError`].
pub fn emit_mcp_rbs_rb(ir: &Ir) -> GenResult<String> {
    let mut output = format!(
        "{}\n",
        generated_header(CommentStyle::Hash, "rb-mcp-rbs-out")
    );
    output.push_str(
        "module SolvaPay\n\
         \x20 module Mcp\n\
         \x20   module Layer2\n",
    );
    let helper_bindings = helper_bindings(ir);
    let mut entries: Vec<_> = ir
        .entry_points
        .values()
        .filter(|entry| entry.ruby_target.receiver == IrRubyReceiver::McpNative)
        .filter(|entry| entry.emission.rb.is_generated())
        .collect();
    entries.sort_by(|left, right| left.ruby_target.name.cmp(&right.ruby_target.name));
    for entry in entries {
        let params = mcp_rbs_params(entry, helper_bindings.get(entry.id.as_str()).copied());
        let _ = writeln!(
            output,
            "    def self.{}: {params} -> untyped",
            entry.ruby_target.name
        );
    }
    output.push_str(
        "    def self.as_object_map: (untyped value) -> Hash[String, untyped]\n\
         \x20   end\n\
         \x20 end\n\
         end\n",
    );
    Ok(output)
}

fn mcp_rbs_params(entry: &IrEntryPoint, binding: Option<&IrBindingSymbol>) -> String {
    if !entry.params.is_empty() {
        return rbs_params(entry, false);
    }
    let Some(binding) = binding else {
        return "()".into();
    };
    let args: Vec<&IrBindingArg> = binding
        .args
        .iter()
        .filter(|arg| !arg.host_injected)
        .collect();
    if args.is_empty() {
        return "()".into();
    }
    let params = args
        .iter()
        .map(|arg| format!("{} {}", rbs_boundary_type(&arg.ty), snake(&arg.name)))
        .collect::<Vec<_>>();
    format!("({})", params.join(", "))
}

fn helper_bindings(ir: &Ir) -> std::collections::BTreeMap<String, &IrBindingSymbol> {
    ir.binding_symbols
        .values()
        .filter_map(|binding| match &binding.catalog {
            IrBindingCatalogLink::TopLevel(id) | IrBindingCatalogLink::CoreHelper(id) => {
                Some((id.clone(), binding))
            }
            _ => None,
        })
        .collect()
}

fn helper_rbs_params(entry: &IrEntryPoint, binding: Option<&IrBindingSymbol>) -> String {
    if !entry.params.is_empty() {
        return rbs_params(entry, true);
    }
    let Some(binding) = binding else {
        return "()".into();
    };
    let args: Vec<&IrBindingArg> = binding
        .args
        .iter()
        .filter(|arg| !arg.host_injected)
        .collect();
    if args.is_empty() {
        return "()".into();
    }
    let required: Vec<bool> = args.iter().map(|arg| arg.required).collect();
    let params = args
        .iter()
        .enumerate()
        .map(|(i, arg)| {
            let name = snake(&arg.name);
            let ty = rbs_boundary_type(&arg.ty);
            if arg.required {
                format!("{name}: {ty}")
            } else if crate::emit_helpers::trailing_has_required(&required, i) {
                format!("{name}: {ty}?")
            } else {
                format!("?{name}: {ty}")
            }
        })
        .collect::<Vec<_>>();
    format!("({})", params.join(", "))
}

fn rbs_params(entry: &IrEntryPoint, keywords: bool) -> String {
    if entry.params.is_empty() {
        return "()".into();
    }
    let required: Vec<bool> = entry.params.iter().map(|param| param.required).collect();
    let params = entry
        .params
        .iter()
        .enumerate()
        .map(|(i, param)| {
            let ty = rbs_type(&param.ty);
            if keywords {
                if param.required {
                    format!("{}: {ty}", param.names.rb)
                } else if crate::emit_helpers::trailing_has_required(&required, i) {
                    format!("{}: {ty}?", param.names.rb)
                } else {
                    format!("?{}: {ty}", param.names.rb)
                }
            } else {
                format!("{ty} {}", param.names.rb)
            }
        })
        .collect::<Vec<_>>();
    format!("({})", params.join(", "))
}

fn rbs_type(ty: &IrTypeRef) -> String {
    match ty {
        IrTypeRef::String | IrTypeRef::LiteralString(_) => "String".into(),
        IrTypeRef::I64 => "Integer".into(),
        IrTypeRef::F64 => "Float".into(),
        IrTypeRef::Bool | IrTypeRef::LiteralBool(_) => "bool".into(),
        IrTypeRef::Vec(item) => format!("Array[{}]", rbs_type(item)),
        IrTypeRef::Map(item) => format!("Hash[String, {}]", rbs_type(item)),
        IrTypeRef::Value | IrTypeRef::Named(_) => "Hash[String, untyped]".into(),
    }
}

fn rbs_boundary_type(ty: &IrBoundaryType) -> String {
    match ty {
        IrBoundaryType::String | IrBoundaryType::StringOpt => "String".into(),
        IrBoundaryType::F64 | IrBoundaryType::F64Opt => "Float".into(),
        IrBoundaryType::I64 => "Integer".into(),
        IrBoundaryType::Bool => "bool".into(),
        IrBoundaryType::Value => "untyped".into(),
    }
}

fn snake(value: &str) -> String {
    let mut output = String::new();
    for (index, character) in value.chars().enumerate() {
        if character.is_uppercase() {
            if index > 0 {
                output.push('_');
            }
            output.extend(character.to_lowercase());
        } else {
            output.push(character);
        }
    }
    output
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    #[test]
    fn excludes_private_native_namespace_leak_in_public_helpers() {
        let ir = Ir {
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
        let output = emit_rbs_rb(&ir).unwrap();
        assert!(output.contains("class Client"));
        assert!(output.contains("def self.create"));
        assert!(output.contains("module NativeDispatch"));
        // Private Magnus module is declared for steep, but public helpers must
        // not re-export `SolvaPay::Native` as a caller-facing namespace alias.
        assert!(!output.contains("Native = "));
    }

    #[test]
    fn helper_params_come_from_binding_args_when_catalog_params_empty() {
        use crate::ir::{
            IrAvailability, IrBindingArg, IrBindingArtifact, IrBindingCall, IrDefaults, IrDocModel,
            IrEmissionMatrix, IrEntrySection, IrEnvelopeMode, IrErrorKind, IrExtractKind,
            IrLangNames, IrRubyTarget, IrSerializeKind, IrSyncKind, IrTypedStyle,
        };

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
        ir.entry_points.insert(
            "deriveTaxIdType".into(),
            IrEntryPoint {
                id: "deriveTaxIdType".into(),
                section: IrEntrySection::TopLevel,
                names: IrLangNames {
                    ts: "deriveTaxIdType".into(),
                    py: "derive_tax_id_type".into(),
                    rb: "derive_tax_id_type".into(),
                    go: "DeriveTaxIdType".into(),
                    rust: "derive_tax_id_type".into(),
                    c: "deriveTaxIdType".into(),
                },
                optional_on_client: false,
                params: vec![],
                type_params: vec![],
                request: None,
                response: None,
                availability: IrAvailability {
                    ts: vec![IrSyncKind::Sync],
                    py: vec![IrSyncKind::Sync],
                    rb: vec![IrSyncKind::Sync],
                    go: vec![IrSyncKind::Sync],
                    rust: vec![IrSyncKind::Sync],
                },
                sync_ts: IrSyncKind::Sync,
                emission: IrEmissionMatrix::default(),
                mcp_surface: None,
                feature: None,
                ruby_target: IrRubyTarget {
                    owner: "SolvaPay".into(),
                    name: "derive_tax_id_type".into(),
                    receiver: IrRubyReceiver::ModuleFunction,
                    takes_block: false,
                },
                defaults: IrDefaults::default(),
                errors: vec![IrErrorKind::Api],
                docs: IrDocModel {
                    summary: "Derive tax id type.".into(),
                    returns: None,
                },
            },
        );
        ir.binding_symbols.insert(
            "derive_tax_id_type".into(),
            IrBindingSymbol {
                id: "derive_tax_id_type".into(),
                core: "solvapay_core::x".into(),
                names: IrLangNames {
                    ts: "deriveTaxIdType".into(),
                    py: "derive_tax_id_type".into(),
                    rb: "derive_tax_id_type".into(),
                    go: "DeriveTaxIdType".into(),
                    rust: "derive_tax_id_type".into(),
                    c: "deriveTaxIdType".into(),
                },
                catalog: IrBindingCatalogLink::TopLevel("deriveTaxIdType".into()),
                args: vec![IrBindingArg {
                    name: "country".into(),
                    ty: IrBoundaryType::String,
                    required: true,
                    host_injected: false,
                    extract: IrExtractKind::RequireString,
                    typed_as: None,
                    typed_style: IrTypedStyle::Turbofish,
                    local: None,
                }],
                split_path_refs: vec![],
                return_shape: "value".into(),
                sync: IrSyncKind::Sync,
                envelope: IrEnvelopeMode::Sync,
                artifact: IrBindingArtifact::Decisions,
                emit_order: 0,
                section: None,
                doc: String::new(),
                doc_wasm: None,
                rust_fn_name: "derive_tax_id_type".into(),
                call: IrBindingCall::Wrap {
                    serialize: IrSerializeKind::ToValue,
                    args: vec![],
                },
                verbatim_body: None,
                verbatim_body_wasm: None,
                dto_type: None,
                core_call: None,
                client_call_args: vec![],
                ts_wrapper: None,
            },
        );
        let output = emit_rbs_rb(&ir).unwrap();
        assert!(output.contains("def self.derive_tax_id_type: (country: String) -> untyped"));
        assert!(!output.contains("module Layer2"));
    }

    #[test]
    fn mcp_rbs_emits_layer2_on_ruby_mcp_not_the_core_gem() {
        use crate::ir::{
            IrAvailability, IrDefaults, IrDocModel, IrEmissionMatrix, IrEntrySection, IrErrorKind,
            IrLangNames, IrParam, IrRubyTarget, IrSyncKind, IrTypeRef,
        };

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
        ir.entry_points.insert(
            "mcpHideToolsByAudience".into(),
            IrEntryPoint {
                id: "mcpHideToolsByAudience".into(),
                section: IrEntrySection::Mcp,
                names: IrLangNames {
                    ts: "mcpHideToolsByAudience".into(),
                    py: "mcp_hide_tools_by_audience".into(),
                    rb: "mcp_hide_tools_by_audience".into(),
                    go: "McpHideToolsByAudience".into(),
                    rust: "mcp_hide_tools_by_audience".into(),
                    c: "mcpHideToolsByAudience".into(),
                },
                optional_on_client: false,
                params: vec![IrParam {
                    name: "tools".into(),
                    names: IrLangNames {
                        ts: "tools".into(),
                        py: "tools".into(),
                        rb: "tools".into(),
                        go: "tools".into(),
                        rust: "tools".into(),
                        c: "tools".into(),
                    },
                    ty: IrTypeRef::Value,
                    required: true,
                    default_value: None,
                    doc: String::new(),
                }],
                type_params: vec![],
                request: None,
                response: None,
                availability: IrAvailability {
                    ts: vec![IrSyncKind::Sync],
                    py: vec![IrSyncKind::Sync],
                    rb: vec![IrSyncKind::Sync],
                    go: vec![IrSyncKind::Sync],
                    rust: vec![IrSyncKind::Sync],
                },
                sync_ts: IrSyncKind::Sync,
                emission: IrEmissionMatrix::default(),
                mcp_surface: Some(crate::ir::IrMcpSurface::Layer2),
                feature: None,
                ruby_target: IrRubyTarget {
                    owner: "SolvaPay::Mcp::Layer2".into(),
                    name: "mcp_hide_tools_by_audience".into(),
                    receiver: IrRubyReceiver::McpNative,
                    takes_block: false,
                },
                defaults: IrDefaults::default(),
                errors: vec![IrErrorKind::Api],
                docs: IrDocModel {
                    summary: "Hide tools by audience.".into(),
                    returns: None,
                },
            },
        );

        let core = emit_rbs_rb(&ir).unwrap();
        assert!(!core.contains("module Layer2"));
        assert!(!core.contains("mcp_hide_tools_by_audience"));

        let mcp = emit_mcp_rbs_rb(&ir).unwrap();
        assert!(mcp.contains("--rb-mcp-rbs-out"));
        assert!(mcp.contains("module Layer2"));
        assert!(mcp.contains(
            "def self.mcp_hide_tools_by_audience: (Hash[String, untyped] tools) -> untyped"
        ));
        assert!(mcp.contains("def self.as_object_map: (untyped value) -> Hash[String, untyped]"));
    }
}
