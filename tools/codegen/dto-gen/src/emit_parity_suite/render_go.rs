//! Go signature-parity suite renderer.

use std::fmt::Write as _;

use crate::error::GenResult;
use crate::header::{generated_header, CommentStyle};
use crate::ir::IrDefaults;

use super::descriptor::{ParityClientOp, ParitySuiteDescriptor};

/// Hand-written `Client` methods that are not catalog operations.
const EXTRA_CLIENT_METHODS: &[&str] = &["Close", "Gate", "Payable"];

/// Renders `signature_parity_generated_test.go` from the shared descriptor.
pub(super) fn render(desc: &ParitySuiteDescriptor) -> GenResult<String> {
    let mut ops: Vec<&ParityClientOp> = desc.client_ops.iter().collect();
    ops.sort_by(|left, right| left.names.go.cmp(&right.names.go));
    let defaults = ops
        .first()
        .map(|entry| entry.defaults.clone())
        .unwrap_or_default();

    let mut output = format!("{}\n", generated_header(CommentStyle::Go, "go-parity-out"));
    output.push_str("package solvapay_test\n\n");
    output.push_str("import (\n");
    output.push_str("\t\"reflect\"\n");
    output.push_str("\t\"testing\"\n\n");
    output.push_str("\tsolvapay \"github.com/solvapay/solvapay-sdk/sdks/go\"\n");
    output.push_str(")\n\n");

    output.push_str(
        "// operationSignature is one catalogued client method: name → param names and reflect types (excluding ctx).\n",
    );
    output.push_str("type operationSignature struct {\n");
    output.push_str("\tname       string\n");
    output.push_str("\tparams     []string\n");
    output.push_str("\tparamTypes []string\n");
    output.push_str("}\n\n");

    output.push_str(
        "// operationSignatures locks the Go facade surface (presence + arity + per-slot types).\n",
    );
    output.push_str("var operationSignatures = []operationSignature{\n");
    for entry in &ops {
        let params = entry
            .go_params
            .iter()
            .map(|param| format!("\"{}\"", param.name))
            .collect::<Vec<_>>()
            .join(", ");
        let types = entry
            .go_params
            .iter()
            .map(|param| format!("\"{}\"", go_reflect_type(&param.ty)))
            .collect::<Vec<_>>()
            .join(", ");
        let params_lit = if params.is_empty() {
            "nil".to_owned()
        } else {
            format!("[]string{{{params}}}")
        };
        let types_lit = if types.is_empty() {
            "nil".to_owned()
        } else {
            format!("[]string{{{types}}}")
        };
        let _ = writeln!(
            output,
            "\t{{\"{}\", {params_lit}, {types_lit}}},",
            entry.names.go
        );
    }
    output.push_str("}\n\n");

    output.push_str(
        "// extraClientMethods are exported Client methods that are not catalog operations.\n",
    );
    output.push_str("var extraClientMethods = map[string]struct{}{\n");
    let extra_name_width = EXTRA_CLIENT_METHODS
        .iter()
        .map(|name| name.len())
        .max()
        .unwrap_or(0);
    for name in EXTRA_CLIENT_METHODS {
        let pad = " ".repeat(extra_name_width - name.len());
        let _ = writeln!(output, "\t\"{name}\":{pad} {{}},");
    }
    output.push_str("}\n\n");

    write_go_defaults(&mut output, &defaults);

    output.push_str("// Compile-time surface refs: each catalogued method is addressable.\n");
    output.push_str("var (\n");
    for entry in &ops {
        let name = &entry.names.go;
        let _ = writeln!(output, "\t_ = (*solvapay.Client).{name}");
    }
    output.push_str(")\n\n");

    let n = ops.len();
    output.push_str(&format!(
        "func TestOperationSignaturesCountIs{n}(t *testing.T) {{\n\
         \tt.Helper()\n\
         \tif got := len(operationSignatures); got != {n} {{\n\
         \t\tt.Fatalf(\"operationSignatures len = %d, want {n}\", got)\n\
         \t}}\n\
         }}\n\n"
    ));
    output.push_str(
        "func TestOperationSignaturesAreSortedUnique(t *testing.T) {\n\
         \tt.Helper()\n\
         \tfor i := 1; i < len(operationSignatures); i++ {\n\
         \t\tprev := operationSignatures[i-1].name\n\
         \t\tcur := operationSignatures[i].name\n\
         \t\tif cur <= prev {\n\
         \t\t\tt.Fatalf(\"operationSignatures not sorted unique: %q then %q\", prev, cur)\n\
         \t\t}\n\
         \t}\n\
         }\n\n\
         func TestOperationSignaturesMatchMethodTypes(t *testing.T) {\n\
         \tt.Helper()\n\
         \tclientType := reflect.TypeOf((*solvapay.Client)(nil))\n\
         \tfor _, sig := range operationSignatures {\n\
         \t\tm, ok := clientType.MethodByName(sig.name)\n\
         \t\tif !ok {\n\
         \t\t\tt.Fatalf(\"missing method %s\", sig.name)\n\
         \t\t}\n\
         \t\t// Receiver + ctx + catalog params.\n\
         \t\twantIn := 2 + len(sig.params)\n\
         \t\tif m.Type.NumIn() != wantIn {\n\
         \t\t\tt.Fatalf(\"%s NumIn = %d, want %d\", sig.name, m.Type.NumIn(), wantIn)\n\
         \t\t}\n\
         \t\tif m.Type.In(1).String() != \"context.Context\" {\n\
         \t\t\tt.Fatalf(\"%s first param = %s, want context.Context\", sig.name, m.Type.In(1))\n\
         \t\t}\n\
         \t\tfor i, want := range sig.paramTypes {\n\
         \t\t\tif got := m.Type.In(i + 2).String(); got != want {\n\
         \t\t\t\tt.Fatalf(\"%s param %d = %s, want %s\", sig.name, i, got, want)\n\
         \t\t\t}\n\
         \t\t}\n\
         \t\tif m.Type.NumOut() != 2 {\n\
         \t\t\tt.Fatalf(\"%s NumOut = %d, want 2\", sig.name, m.Type.NumOut())\n\
         \t\t}\n\
         \t\tif m.Type.Out(0).String() != \"interface {}\" {\n\
         \t\t\tt.Fatalf(\"%s Out(0) = %s, want interface {}\", sig.name, m.Type.Out(0))\n\
         \t\t}\n\
         \t\tif m.Type.Out(1).String() != \"error\" {\n\
         \t\t\tt.Fatalf(\"%s Out(1) = %s, want error\", sig.name, m.Type.Out(1))\n\
         \t\t}\n\
         \t}\n\
         }\n\n\
         func TestExportedClientMethodsMatchCensus(t *testing.T) {\n\
         \tt.Helper()\n\
         \tclientType := reflect.TypeOf((*solvapay.Client)(nil))\n\
         \twant := make(map[string]struct{}, len(operationSignatures)+len(extraClientMethods))\n\
         \tfor _, sig := range operationSignatures {\n\
         \t\twant[sig.name] = struct{}{}\n\
         \t}\n\
         \tfor name := range extraClientMethods {\n\
         \t\twant[name] = struct{}{}\n\
         \t}\n\
         \tfor i := 0; i < clientType.NumMethod(); i++ {\n\
         \t\tname := clientType.Method(i).Name\n\
         \t\tif _, ok := want[name]; !ok {\n\
         \t\t\tt.Fatalf(\"unexpected exported Client method %s\", name)\n\
         \t\t}\n\
         \t\tdelete(want, name)\n\
         \t}\n\
         \tfor name := range want {\n\
         \t\tt.Fatalf(\"missing exported Client method %s\", name)\n\
         \t}\n\
         }\n\n\
         func TestRuntimeDefaultsMatchManifest(t *testing.T) {\n\
         \tt.Helper()\n\
         \tif expectedLimitsCacheTTLMs != solvapay.DefaultLimitsCacheTTLMs {\n\
         \t\tt.Fatalf(\"limits cache TTL = %d, want %d\", expectedLimitsCacheTTLMs, solvapay.DefaultLimitsCacheTTLMs)\n\
         \t}\n\
         \tif expectedMaxRetries != solvapay.DefaultMaxRetries {\n\
         \t\tt.Fatalf(\"max retries = %d, want %d\", expectedMaxRetries, solvapay.DefaultMaxRetries)\n\
         \t}\n\
         \tif expectedInitialDelayMs != solvapay.DefaultInitialDelayMs {\n\
         \t\tt.Fatalf(\"initial delay = %d, want %d\", expectedInitialDelayMs, solvapay.DefaultInitialDelayMs)\n\
         \t}\n\
         \tif expectedCustomerDedupTTLMs != solvapay.CustomerDedupTTLMs {\n\
         \t\tt.Fatalf(\"customer dedup TTL = %d, want %d\", expectedCustomerDedupTTLMs, solvapay.CustomerDedupTTLMs)\n\
         \t}\n\
         \tif expectedCustomerDedupMaxCacheSize != solvapay.CustomerDedupMaxCacheSize {\n\
         \t\tt.Fatalf(\"customer dedup max = %d, want %d\", expectedCustomerDedupMaxCacheSize, solvapay.CustomerDedupMaxCacheSize)\n\
         \t}\n\
         \tif expectedAnonymousCustomerRef != solvapay.AnonymousCustomerRef {\n\
         \t\tt.Fatalf(\"anonymous ref = %q, want %q\", expectedAnonymousCustomerRef, solvapay.AnonymousCustomerRef)\n\
         \t}\n\
         \tif expectedRequestIdFormat != solvapay.RequestIDFormat {\n\
         \t\tt.Fatalf(\"request id format = %q, want %q\", expectedRequestIdFormat, solvapay.RequestIDFormat)\n\
         \t}\n\
         \tif expectedUsageActionType != solvapay.UsageActionType {\n\
         \t\tt.Fatalf(\"usage action type = %q, want %q\", expectedUsageActionType, solvapay.UsageActionType)\n\
         \t}\n\
         }\n\n\
         func TestSyncOnlyMatrix(t *testing.T) {\n\
         \tt.Helper()\n\
         \t// Go facade is sync-only (blocking); there are no Async / Blocking twin methods.\n\
         \tclientType := reflect.TypeOf((*solvapay.Client)(nil))\n\
         \tfor _, sig := range operationSignatures {\n\
         \t\tif _, ok := clientType.MethodByName(sig.name + \"Async\"); ok {\n\
         \t\t\tt.Fatalf(\"unexpected async twin %sAsync\", sig.name)\n\
         \t\t}\n\
         \t\tif _, ok := clientType.MethodByName(sig.name + \"Blocking\"); ok {\n\
         \t\t\tt.Fatalf(\"unexpected blocking twin %sBlocking\", sig.name)\n\
         \t\t}\n\
         \t}\n\
         }\n",
    );

    Ok(output)
}

fn write_go_defaults(output: &mut String, defaults: &IrDefaults) {
    let _ = writeln!(
        output,
        "// Frozen limits-cache TTL from the contract manifest `defaults:`.\n\
         const expectedLimitsCacheTTLMs = {}\n",
        defaults.limits_cache_ttl_ms
    );
    let _ = writeln!(
        output,
        "// Frozen retry max from the contract manifest `defaults:`.\n\
         const expectedMaxRetries = {}\n",
        defaults.max_retries
    );
    let _ = writeln!(
        output,
        "// Frozen initial retry delay from the contract manifest `defaults:`.\n\
         const expectedInitialDelayMs = {}\n",
        defaults.initial_delay_ms
    );
    let _ = writeln!(
        output,
        "// Frozen customer-dedup TTL from the contract manifest `defaults:`.\n\
         const expectedCustomerDedupTTLMs = {}\n",
        defaults.customer_dedup_ttl_ms
    );
    let _ = writeln!(
        output,
        "// Frozen customer-dedup max cache size from the contract manifest `defaults:`.\n\
         const expectedCustomerDedupMaxCacheSize = {}\n",
        defaults.customer_dedup_max_cache_size
    );
    let _ = writeln!(
        output,
        "// Frozen anonymous customer ref from the contract manifest `defaults:`.\n\
         const expectedAnonymousCustomerRef = \"{}\"\n",
        defaults.anonymous_customer_ref
    );
    let _ = writeln!(
        output,
        "// Frozen trackUsage request-id format from the contract manifest `defaults:`.\n\
         const expectedRequestIdFormat = \"{}\"\n",
        defaults.request_id_format
    );
    let _ = writeln!(
        output,
        "// Frozen trackUsage actionType from the contract manifest `defaults:`.\n\
         const expectedUsageActionType = \"{}\"\n",
        defaults.usage_action_type
    );
}

/// Maps Go source types onto `reflect.Type.String()` output.
fn go_reflect_type(ty: &str) -> String {
    match ty {
        "map[string]any" => "map[string]interface {}".into(),
        "any" => "interface {}".into(),
        other => other.to_owned(),
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
mod tests {
    use crate::emit_parity_suite_go;
    use crate::ir::{
        Ir, IrAvailability, IrBindingArtifact, IrBindingCall, IrBindingCatalogLink,
        IrBindingSymbol, IrDefaults, IrDocModel, IrEmissionMatrix, IrEntryPoint, IrEntrySection,
        IrEnvelopeMode, IrErrorKind, IrLangNames, IrParam, IrRubyReceiver, IrRubyTarget,
        IrSerializeKind, IrSyncKind, IrTypeRef,
    };
    use std::collections::BTreeMap;

    fn empty_ir() -> Ir {
        Ir {
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
        }
    }

    fn names(go: &str, rust: &str) -> IrLangNames {
        IrLangNames {
            ts: rust.into(),
            py: rust.into(),
            rb: rust.into(),
            go: go.into(),
            rust: rust.into(),
            c: rust.into(),
        }
    }

    fn split_op(
        id: &str,
        go: &str,
        rust: &str,
        params: Vec<IrParam>,
    ) -> (IrEntryPoint, IrBindingSymbol) {
        let split_path_refs: Vec<String> = params.iter().map(|p| p.name.clone()).collect();
        let entry = IrEntryPoint {
            id: id.into(),
            section: IrEntrySection::Operation,
            names: names(go, rust),
            optional_on_client: false,
            params,
            type_params: vec![],
            request: None,
            response: Some("void".into()),
            availability: IrAvailability {
                ts: vec![IrSyncKind::Async],
                py: vec![IrSyncKind::Async, IrSyncKind::Sync],
                rb: vec![IrSyncKind::Sync],
                go: vec![IrSyncKind::Sync],
                rust: vec![IrSyncKind::Async, IrSyncKind::Sync],
            },
            sync_ts: IrSyncKind::Async,
            emission: IrEmissionMatrix::default(),
            mcp_surface: None,
            feature: None,
            ruby_target: IrRubyTarget {
                owner: "SolvaPay::Client".into(),
                name: rust.into(),
                receiver: IrRubyReceiver::ClientInstance,
                takes_block: false,
            },
            defaults: IrDefaults::default(),
            errors: vec![IrErrorKind::Api],
            docs: IrDocModel::default(),
        };
        let binding = IrBindingSymbol {
            id: id.into(),
            core: format!("solvapay_transport::SolvaPayClient::{rust}"),
            names: names(go, rust),
            catalog: IrBindingCatalogLink::Operation(id.into()),
            args: vec![],
            split_path_refs,
            return_shape: "value".into(),
            sync: IrSyncKind::Async,
            envelope: IrEnvelopeMode::Async,
            artifact: IrBindingArtifact::Client,
            emit_order: 0,
            section: None,
            doc: String::new(),
            doc_wasm: None,
            rust_fn_name: rust.into(),
            call: IrBindingCall::Wrap {
                serialize: IrSerializeKind::ClientSplit,
                args: vec![],
            },
            verbatim_body: None,
            verbatim_body_wasm: None,
            dto_type: None,
            core_call: Some(rust.into()),
            client_call_args: vec![],
            ts_wrapper: None,
        };
        (entry, binding)
    }

    fn param_string(name: &str, go: &str, rust: &str) -> IrParam {
        IrParam {
            name: name.into(),
            names: names(go, rust),
            required: true,
            ty: IrTypeRef::String,
            default_value: None,
            doc: String::new(),
        }
    }

    fn ir_with(entry: IrEntryPoint, binding: IrBindingSymbol) -> Ir {
        let mut ir = empty_ir();
        ir.entry_points.insert(entry.id.clone(), entry);
        ir.binding_symbols.insert(binding.id.clone(), binding);
        ir
    }

    #[test]
    fn emits_count_assert_defaults_and_no_tautologies() {
        let output = emit_parity_suite_go(&empty_ir()).unwrap();
        assert!(output.contains("// Code generated by dto-gen. DO NOT EDIT."));
        assert!(output.contains("// @generated"));
        assert!(output.contains("len(operationSignatures); got != 0"));
        assert!(output.contains("paramTypes"));
        assert!(output.contains("TestExportedClientMethodsMatchCensus"));
        assert!(output.contains("\"Close\":   {}"));
        assert!(output.contains("\"Gate\":    {}"));
        assert!(output.contains("\"Payable\": {}"));
        assert!(output.contains("m.Type.In(i + 2).String()"));
        assert!(output.contains("expectedLimitsCacheTTLMs"));
        assert!(output.contains("expectedMaxRetries"));
        assert!(output.contains("expectedInitialDelayMs"));
        assert!(output.contains("expectedCustomerDedupTTLMs"));
        assert!(output.contains("expectedUsageActionType"));
        assert!(output.contains("TestSyncOnlyMatrix"));
        assert!(!output.contains("2 == 2"));
        assert!(!output.contains("|| true"));
    }

    #[test]
    fn swapped_params_change_emitted_types_and_order() {
        let left_params = vec![
            param_string("productRef", "productRef", "product_ref"),
            param_string("planRef", "planRef", "plan_ref"),
        ];
        let right_params = vec![
            param_string("planRef", "planRef", "plan_ref"),
            param_string("productRef", "productRef", "product_ref"),
        ];
        let (left_entry, left_binding) =
            split_op("deletePlan", "DeletePlan", "delete_plan", left_params);
        let (right_entry, right_binding) =
            split_op("deletePlan", "DeletePlan", "delete_plan", right_params);
        let left = emit_parity_suite_go(&ir_with(left_entry, left_binding)).unwrap();
        let right = emit_parity_suite_go(&ir_with(right_entry, right_binding)).unwrap();
        assert_ne!(left, right);
        assert!(left.contains("[]string{\"productRef\", \"planRef\"}"));
        assert!(right.contains("[]string{\"planRef\", \"productRef\"}"));
    }
}
