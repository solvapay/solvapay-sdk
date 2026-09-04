//! C signature-parity suite renderer.

use std::fmt::Write as _;

use crate::error::GenResult;
use crate::header::{generated_header, CommentStyle};

use super::descriptor::ParitySuiteDescriptor;

/// Renders `sdks/capi/ctest/signature_parity_generated.c` from the shared descriptor.
pub(super) fn render(desc: &ParitySuiteDescriptor) -> GenResult<String> {
    let symbols = &desc.client_bindings;

    let max_required = symbols
        .iter()
        .map(|sym| sym.split_path_refs.len() + 1)
        .max()
        .unwrap_or(1);

    let mut output = format!(
        "{}\n",
        generated_header(CommentStyle::CBlock, "c-parity-out")
    );
    output.push_str("#include \"../include/solvapay.h\"\n\n");
    output.push_str("#include <stdio.h>\n");
    output.push_str("#include <string.h>\n\n");

    output.push_str("/* Link-time refs: the cdylib must retain every public ABI symbol. */\n");
    output.push_str("static void keep_abi_symbols(void) {\n");
    output.push_str("  (void)&solvapay_abi_version;\n");
    output.push_str("  (void)&solvapay_version;\n");
    output.push_str("  (void)&solvapay_build_info;\n");
    output.push_str("  (void)&solvapay_client_new;\n");
    output.push_str("  (void)&solvapay_client_call;\n");
    output.push_str("  (void)&solvapay_verify_webhook;\n");
    output.push_str("  (void)&solvapay_client_free;\n");
    output.push_str("  (void)&solvapay_free_string;\n");
    output.push_str("}\n\n");

    output.push_str("static const char *kOps[] = {\n");
    for sym in symbols {
        let _ = writeln!(output, "  \"{}\",", sym.id);
    }
    output.push_str("};\n\n");

    let _ = writeln!(
        output,
        "/* Required split-path args per op. The C envelope names the first missing key only,\n\
         * so the suite probes sequentially: fill prior keys, assert the next name appears.\n\
         */\n\
         enum {{ kMaxRequired = {max_required} }};\n\
         static const char *kRequiredArgs[][kMaxRequired] = {{"
    );
    for sym in symbols {
        output.push_str("  {");
        for (i, name) in sym.split_path_refs.iter().enumerate() {
            if i > 0 {
                output.push_str(", ");
            }
            let _ = write!(output, "\"{name}\"");
        }
        if !sym.split_path_refs.is_empty() {
            output.push_str(", ");
        }
        output.push_str("NULL");
        let pad = max_required.saturating_sub(sym.split_path_refs.len() + 1);
        for _ in 0..pad {
            output.push_str(", NULL");
        }
        output.push_str("},\n");
    }
    output.push_str("};\n\n");

    output.push_str(
        "static int json_with_filled(char *buf, size_t bufsz, const char *const *args, size_t filled) {\n\
         \tsize_t n = 0;\n\
         \tint wrote;\n\
         \twrote = snprintf(buf + n, bufsz - n, \"{\");\n\
         \tif (wrote < 0 || (size_t)wrote >= bufsz - n) {\n\
         \t\treturn -1;\n\
         \t}\n\
         \tn += (size_t)wrote;\n\
         \tfor (size_t i = 0; i < filled; i++) {\n\
         \t\twrote = snprintf(buf + n, bufsz - n, \"%s\\\"%s\\\":\\\"x\\\"\", i == 0 ? \"\" : \",\", args[i]);\n\
         \t\tif (wrote < 0 || (size_t)wrote >= bufsz - n) {\n\
         \t\t\treturn -1;\n\
         \t\t}\n\
         \t\tn += (size_t)wrote;\n\
         \t}\n\
         \twrote = snprintf(buf + n, bufsz - n, \"}\");\n\
         \tif (wrote < 0 || (size_t)wrote >= bufsz - n) {\n\
         \t\treturn -1;\n\
         \t}\n\
         \treturn 0;\n\
         }\n\n",
    );

    let n = symbols.len();
    let _ = writeln!(
        output,
        "int main(void) {{\n\
         \tkeep_abi_symbols();\n\
         \tif (solvapay_abi_version() != SOLVAPAY_ABI_VERSION) {{\n\
         \t\tfprintf(stderr, \"FAIL: abi_version=%u header=%d\\n\",\n\
         \t\t        solvapay_abi_version(), SOLVAPAY_ABI_VERSION);\n\
         \t\treturn 1;\n\
         \t}}\n\
         \tsize_t nops = sizeof(kOps) / sizeof(kOps[0]);\n\
         \tif (nops != {n}) {{\n\
         \t\tfprintf(stderr, \"FAIL: kOps len = %zu, want {n}\\n\", nops);\n\
         \t\treturn 1;\n\
         \t}}\n"
    );
    output.push_str(
        "\tSolvapayClient *client = NULL;\n\
         \tSolvapayStatus status = solvapay_client_new(\n\
         \t    \"{\\\"apiKey\\\":\\\"sk_parity\\\",\\\"apiBaseUrl\\\":\\\"http://127.0.0.1:1\\\"}\",\n\
         \t    &client);\n\
         \tif (status != SolvapayStatus_Ok || client == NULL) {\n\
         \t\tfprintf(stderr, \"FAIL: client_new status=%d\\n\", (int)status);\n\
         \t\treturn 1;\n\
         \t}\n\
         \tfor (size_t i = 0; i < nops; i++) {\n\
         \t\tchar *env = solvapay_client_call(client, kOps[i], \"{}\");\n\
         \t\tif (env == NULL) {\n\
         \t\t\tfprintf(stderr, \"FAIL: %s returned null envelope\\n\", kOps[i]);\n\
         \t\t\tsolvapay_client_free(client);\n\
         \t\t\treturn 1;\n\
         \t\t}\n\
         \t\tif (strstr(env, \"unknown op\") != NULL) {\n\
         \t\t\tfprintf(stderr, \"FAIL: %s is unknown op: %s\\n\", kOps[i], env);\n\
         \t\t\tsolvapay_free_string(env);\n\
         \t\t\tsolvapay_client_free(client);\n\
         \t\t\treturn 1;\n\
         \t\t}\n\
         \t\tsolvapay_free_string(env);\n\
         \t\tfor (size_t a = 0; a < (size_t)kMaxRequired && kRequiredArgs[i][a] != NULL; a++) {\n\
         \t\t\tchar json[256];\n\
         \t\t\tif (json_with_filled(json, sizeof(json), kRequiredArgs[i], a) != 0) {\n\
         \t\t\t\tfprintf(stderr, \"FAIL: %s json buffer overflow\\n\", kOps[i]);\n\
         \t\t\t\tsolvapay_client_free(client);\n\
         \t\t\t\treturn 1;\n\
         \t\t\t}\n\
         \t\t\tenv = solvapay_client_call(client, kOps[i], json);\n\
         \t\t\tif (env == NULL) {\n\
         \t\t\t\tfprintf(stderr, \"FAIL: %s returned null envelope for %s\\n\", kOps[i], json);\n\
         \t\t\t\tsolvapay_client_free(client);\n\
         \t\t\t\treturn 1;\n\
         \t\t\t}\n\
         \t\t\tif (strstr(env, kRequiredArgs[i][a]) == NULL) {\n\
         \t\t\t\tfprintf(stderr, \"FAIL: %s missing %s in %s: %s\\n\",\n\
         \t\t\t\t        kOps[i], kRequiredArgs[i][a], json, env);\n\
         \t\t\t\tsolvapay_free_string(env);\n\
         \t\t\t\tsolvapay_client_free(client);\n\
         \t\t\t\treturn 1;\n\
         \t\t\t}\n\
         \t\t\tsolvapay_free_string(env);\n\
         \t\t}\n\
         \t}\n\
         \tsolvapay_client_free(client);\n"
    );
    let _ = writeln!(output, "\tprintf(\"OK: C signature parity ({n} ops)\\n\");");
    output.push_str(
        "\treturn 0;\n\
         }\n",
    );

    Ok(output)
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
mod tests {
    use crate::emit_parity_suite_c;
    use crate::ir::{
        Ir, IrBindingArtifact, IrBindingCall, IrBindingCatalogLink, IrBindingSymbol,
        IrEnvelopeMode, IrLangNames, IrSerializeKind, IrSyncKind,
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

    fn client_sym(id: &str, split_path_refs: Vec<String>) -> IrBindingSymbol {
        IrBindingSymbol {
            id: id.into(),
            core: format!("solvapay_transport::SolvaPayClient::{id}"),
            names: IrLangNames {
                ts: id.into(),
                py: id.into(),
                rb: id.into(),
                go: id.into(),
                rust: id.into(),
                c: id.into(),
            },
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
            rust_fn_name: id.into(),
            call: IrBindingCall::Wrap {
                serialize: IrSerializeKind::ClientSplit,
                args: vec![],
            },
            verbatim_body: None,
            verbatim_body_wasm: None,
            dto_type: None,
            core_call: Some(id.into()),
            client_call_args: vec![],
            ts_wrapper: None,
        }
    }

    #[test]
    fn emits_count_assert_keep_symbols_and_no_tautologies() {
        let output = emit_parity_suite_c(&empty_ir()).unwrap();
        assert!(output.contains("@generated"));
        assert!(output.contains("nops != 0"));
        assert!(output.contains("(void)&solvapay_client_call"));
        assert!(output.contains("unknown op"));
        assert!(output.contains("kRequiredArgs[][kMaxRequired]"));
        assert!(output.contains("json_with_filled"));
        assert!(!output.contains("2 == 2"));
        assert!(!output.contains("|| true"));
    }

    #[test]
    fn swapped_required_args_change_emitted_table() {
        let mut left = empty_ir();
        left.binding_symbols.insert(
            "deletePlan".into(),
            client_sym("deletePlan", vec!["productRef".into(), "planRef".into()]),
        );
        let mut right = empty_ir();
        right.binding_symbols.insert(
            "deletePlan".into(),
            client_sym("deletePlan", vec!["planRef".into(), "productRef".into()]),
        );
        let left_out = emit_parity_suite_c(&left).unwrap();
        let right_out = emit_parity_suite_c(&right).unwrap();
        assert_ne!(left_out, right_out);
        assert!(left_out.contains("\"productRef\", \"planRef\", NULL"));
        assert!(right_out.contains("\"planRef\", \"productRef\", NULL"));
    }
}
