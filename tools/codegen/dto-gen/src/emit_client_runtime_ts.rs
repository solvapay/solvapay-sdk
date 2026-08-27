//! Emit TypeScript runtime client wrappers (`client.runtime.generated.ts`).

use std::fmt::Write as _;

use crate::emit_client_go::serialize_kind;
use crate::emit_client_rs::client_operations;
use crate::error::{GenError, GenResult};
use crate::header::{generated_header, CommentStyle};
use crate::ir::{Ir, IrBindingSymbol, IrEntryPoint, IrSerializeKind, IrTypeRef};

/// Emits `sdks/typescript/server/src/client.runtime.generated.ts`.
///
/// Host plumbing (`dispatchClient`) stays in `client.ts`; this file is only
/// the catalogued one-line wrappers.
///
/// # Errors
///
/// Returns formatting / IR shape failures as [`GenError`].
pub fn emit_client_runtime_ts(ir: &Ir) -> GenResult<String> {
    let mut ops = client_operations(ir);
    ops.sort_by(|left, right| left.0.names.ts.cmp(&right.0.names.ts));

    let mut output = generated_header(CommentStyle::Block, "ts-client-runtime-out");
    output.push('\n');
    output.push_str("import type { SolvaPayClient } from './types'\n\n");
    output.push_str("/** Catalogued client methods dispatched through Node native or WASM. */\n");
    output.push_str("export type NativeClientMethod =\n");
    for (entry, _) in &ops {
        let _ = writeln!(output, "  | '{}'", entry.names.ts);
    }
    output.push('\n');
    output.push_str(
        "export type ClientRuntimeDispatch = <T>(fn: NativeClientMethod, params: unknown) => Promise<T>\n\n",
    );
    output.push_str("export function createGeneratedClientOperations(\n");
    output.push_str("  dispatchClient: ClientRuntimeDispatch,\n");
    output.push_str("): SolvaPayClient {\n");
    output.push_str("  return {\n");
    for (entry, binding) in &ops {
        write_method(&mut output, entry, binding)?;
    }
    output.push_str("  }\n}\n");
    Ok(output)
}

fn write_method(
    output: &mut String,
    entry: &IrEntryPoint,
    binding: &IrBindingSymbol,
) -> GenResult<()> {
    let name = entry.names.ts.as_str();
    let params = ts_param_list(entry);
    let payload = dispatch_payload(entry, binding)?;
    let _ = writeln!(output, "    async {name}({params}) {{");
    let _ = writeln!(output, "      return dispatchClient('{name}', {payload})");
    output.push_str("    },\n");
    Ok(())
}

fn ts_param_list(entry: &IrEntryPoint) -> String {
    entry
        .params
        .iter()
        .map(|param| param.names.ts.as_str())
        .collect::<Vec<_>>()
        .join(", ")
}

fn dispatch_payload(entry: &IrEntryPoint, binding: &IrBindingSymbol) -> GenResult<String> {
    match serialize_kind(binding)? {
        IrSerializeKind::ClientIgnore => Ok("{}".into()),
        IrSerializeKind::ClientAwait => Ok(await_payload(entry)),
        IrSerializeKind::ClientSplit => Ok(split_payload(entry, binding)),
        other => Err(GenError::Parse(format!(
            "unexpected serialize kind for {}: {other:?}",
            entry.id
        ))),
    }
}

fn await_payload(entry: &IrEntryPoint) -> String {
    match entry.params.as_slice() {
        [] => "{}".into(),
        [param] if is_scalar(&param.ty) => format!("{{ {} }}", param.names.ts),
        [param] => param.names.ts.clone(),
        params => {
            let fields = params
                .iter()
                .map(|param| param.names.ts.as_str())
                .collect::<Vec<_>>()
                .join(", ");
            format!("{{ {fields} }}")
        }
    }
}

fn split_payload(entry: &IrEntryPoint, binding: &IrBindingSymbol) -> String {
    let mut parts: Vec<String> = binding.split_path_refs.iter().cloned().collect();
    for param in &entry.params {
        if binding.split_path_refs.iter().any(|key| key == &param.name) {
            continue;
        }
        let ts_name = param.names.ts.as_str();
        if param.required {
            parts.push(format!("...{ts_name}"));
        } else {
            parts.push(format!("...({ts_name} ?? {{}})"));
        }
    }
    format!("{{ {} }}", parts.join(", "))
}

fn is_scalar(ty: &IrTypeRef) -> bool {
    matches!(
        ty,
        IrTypeRef::String | IrTypeRef::I64 | IrTypeRef::F64 | IrTypeRef::Bool
    )
}
