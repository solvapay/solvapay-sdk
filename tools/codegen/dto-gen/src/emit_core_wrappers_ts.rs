//! Emit core/server TypeScript dispatch wrappers (Phase 3c / 3d).
//!
//! Method-name unions and wrapper functions come from binding IR + scanned
//! signatures. Install-gate chrome, import preambles, function order, and the
//! server paywall/retry postamble come from
//! `assets/core-wrappers-ts-emit.snapshot.json`.

use serde_json::Value;

use crate::error::{GenError, GenResult};
use crate::header::{generated_header, CommentStyle};
use crate::ir::{
    Ir, IrBindingArg, IrBindingArtifact, IrBindingSymbol, IrCoreFieldTy, IrCoreFn, IrCoreParam,
    IrCoreParamTy, IrTsWrapper,
};
use crate::lower_core_types::core_fn_for;

/// Match repo Prettier `printWidth` so `pnpm format:check` stays green.
const PRINT_WIDTH: usize = 100;

const SNAPSHOT: &str = include_str!("../assets/core-wrappers-ts-emit.snapshot.json");

const MCP_SECTION: &str = "MCP payload / descriptors";
const PAYWALL_STATE_SECTION: &str = "paywall state / gate / payload";
const RETRY_SECTION: &str = "retry";
const PRODUCT_READINESS_SECTION: &str = "product-readiness";

const DOMAIN_SECTIONS: &[&str] = &["business-details", "credit-display", "seller-identity"];

/// Which wrapper file to emit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CoreWrapperKind {
    /// `packages/core/src/native-dispatch.ts`
    Dispatch,
    /// `packages/core/src/native-core.ts`
    NativeCore,
    /// `packages/core/src/native-helpers.ts`
    NativeHelpers,
    /// `packages/server/src/native-decisions.ts`
    NativeDecisions,
}

/// Emits one core/server dispatch-wrapper TypeScript file.
///
/// # Errors
///
/// Missing chrome snapshot fields, unresolved core-fn joins, or unknown
/// wrapper residue.
pub fn emit_core_wrappers_ts(ir: &Ir, kind: CoreWrapperKind) -> GenResult<String> {
    let chrome: Value = serde_json::from_str(SNAPSHOT)
        .map_err(|e| GenError::Parse(format!("invalid core-wrappers-ts-emit snapshot: {e}")))?;
    match kind {
        CoreWrapperKind::Dispatch => emit_dispatch(ir, &chrome, "core-dispatch-ts-out"),
        CoreWrapperKind::NativeCore => emit_functions_file(
            ir,
            &chrome,
            "nativeCore",
            WrapperSet::Core,
            "core-native-ts-out",
        ),
        CoreWrapperKind::NativeHelpers => emit_functions_file(
            ir,
            &chrome,
            "nativeHelpers",
            WrapperSet::Helpers,
            "core-helpers-ts-out",
        ),
        CoreWrapperKind::NativeDecisions => emit_functions_file(
            ir,
            &chrome,
            "nativeDecisions",
            WrapperSet::Decisions,
            "server-decisions-ts-out",
        ),
    }
}

#[derive(Clone, Copy)]
enum WrapperSet {
    Core,
    Helpers,
    Decisions,
}

fn emit_dispatch(ir: &Ir, chrome: &Value, flag: &str) -> GenResult<String> {
    let file = chrome
        .get("files")
        .and_then(|f| f.get("dispatch"))
        .ok_or_else(|| GenError::Parse("snapshot missing files.dispatch".into()))?;
    let preamble = chrome_str(file, &["preamble"])?;
    let domain_comment = chrome_str(file, &["domainComment"])?;
    let helpers_comment = chrome_str(file, &["helpersComment"])?;
    let postamble = chrome_str(file, &["postamble"])?;

    let mut lines = Vec::new();
    lines.push(domain_comment.to_string());
    let domain_ids = chrome_string_array(file, "domainMembers")?;
    emit_union_members(ir, &domain_ids, &mut lines, is_domain_payload)?;
    lines.push(helpers_comment.to_string());
    let helper_ids = chrome_string_array(file, "helpersMembers")?;
    emit_union_members(ir, &helper_ids, &mut lines, is_core_union_decision)?;

    let header = format!("{}\n", generated_header(CommentStyle::Block, flag));
    let body = lines.join("\n");
    Ok(format!("{header}{preamble}{body}\n\n{postamble}"))
}

fn emit_union_members(
    ir: &Ir,
    ids: &[String],
    lines: &mut Vec<String>,
    pred: fn(&IrBindingSymbol) -> bool,
) -> GenResult<()> {
    let mut expected: Vec<String> = ir
        .binding_symbols
        .values()
        .filter(|s| pred(s))
        .map(|s| s.names.ts.clone())
        .collect();
    expected.sort();
    let mut seen = ids.to_vec();
    seen.sort();
    if seen != expected {
        return Err(GenError::Parse(format!(
            "NativeCoreSyncMethod chrome members drifted (chrome={seen:?} ir={expected:?})"
        )));
    }
    for id in ids {
        lines.push(format!("  | '{id}'"));
    }
    Ok(())
}

fn emit_functions_file(
    ir: &Ir,
    chrome: &Value,
    key: &str,
    set: WrapperSet,
    flag: &str,
) -> GenResult<String> {
    let file = chrome
        .get("files")
        .and_then(|f| f.get(key))
        .ok_or_else(|| GenError::Parse(format!("snapshot missing files.{key}")))?;
    let preamble = chrome_str(file, &["preamble"])?;
    let postamble = file.get("postamble").and_then(Value::as_str).unwrap_or("");
    let order = chrome_string_array(file, "symbolOrder")?;
    let section_before = file
        .get("sectionBefore")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();

    let mut expected: Vec<&str> = matching_symbols(ir, set)
        .into_iter()
        .map(|s| s.id.as_str())
        .collect();
    expected.sort_unstable();
    let mut sorted_order: Vec<&str> = order.iter().map(String::as_str).collect();
    sorted_order.sort_unstable();
    if sorted_order != expected {
        return Err(GenError::Parse(format!(
            "files.{key}.symbolOrder drifted from IR (chrome={sorted_order:?} ir={expected:?})"
        )));
    }

    let mut body = String::new();
    for id in order.iter() {
        if let Some(Value::String(comment)) = section_before.get(id) {
            if !body.is_empty() && !body.ends_with("\n\n") {
                body.push('\n');
            }
            body.push_str(comment);
            if !comment.ends_with('\n') {
                body.push('\n');
            }
            body.push('\n');
        }
        let sym = ir.binding_symbols.get(id).ok_or_else(|| {
            GenError::Parse(format!("files.{key}.symbolOrder unknown binding {id}"))
        })?;
        let func = core_fn_for(ir, sym)?;
        let server = matches!(set, WrapperSet::Decisions);
        body.push_str(&emit_wrapper(ir, sym, func, server)?);
        body.push('\n');
    }
    if postamble.is_empty() {
        while body.ends_with("\n\n") {
            body.pop();
        }
        if !body.ends_with('\n') {
            body.push('\n');
        }
    }

    let mut out = String::new();
    out.push_str(&generated_header(CommentStyle::Block, flag));
    out.push('\n');
    out.push_str(preamble);
    if !preamble.ends_with('\n') {
        out.push('\n');
    }
    out.push_str(&body);
    if !postamble.is_empty() {
        if !out.ends_with('\n') {
            out.push('\n');
        }
        out.push_str(postamble);
    }
    if !out.ends_with('\n') {
        out.push('\n');
    }
    Ok(out)
}

fn matching_symbols(ir: &Ir, set: WrapperSet) -> Vec<&IrBindingSymbol> {
    ir.binding_symbols
        .values()
        .filter(|s| match set {
            WrapperSet::Core => is_domain_payload(s),
            WrapperSet::Helpers => is_helper_decision(s),
            WrapperSet::Decisions => is_server_ir_decision(s),
        })
        .collect()
}

fn is_domain_payload(sym: &IrBindingSymbol) -> bool {
    sym.artifact == IrBindingArtifact::PayloadBuilders
        && DOMAIN_SECTIONS.contains(&sym.section.as_deref().unwrap_or(""))
}

fn is_core_union_decision(sym: &IrBindingSymbol) -> bool {
    sym.artifact == IrBindingArtifact::Decisions && !is_server_only_section(sym)
}

fn is_helper_decision(sym: &IrBindingSymbol) -> bool {
    is_core_union_decision(sym) && sym.section.as_deref() != Some(PRODUCT_READINESS_SECTION)
}

fn is_server_ir_decision(sym: &IrBindingSymbol) -> bool {
    is_core_union_decision(sym)
}

fn is_server_only_section(sym: &IrBindingSymbol) -> bool {
    matches!(
        sym.section.as_deref(),
        Some(PAYWALL_STATE_SECTION | RETRY_SECTION | MCP_SECTION)
    )
}

fn emit_wrapper(
    ir: &Ir,
    sym: &IrBindingSymbol,
    func: &IrCoreFn,
    server: bool,
) -> GenResult<String> {
    let wrap = sym.ts_wrapper.clone().unwrap_or_default();
    let export_name = wrap.export_name.as_deref().unwrap_or(sym.names.ts.as_str());
    let generics = wrap.generics.clone().unwrap_or_default();
    let method = &sym.names.ts;

    let mut out = String::new();
    if let Some(doc) = wrap.doc.as_deref().filter(|d| !d.is_empty()) {
        if !server {
            out.push_str(&format_jsdoc(doc));
        }
    }

    let (params_src, ret_src) = signature_parts(ir, sym, func, &wrap, export_name, &generics)?;
    let dispatch_expr = dispatch_expr(sym, func, &wrap)?;
    let body = match wrap.post_process.as_deref() {
        Some("nullToUndefined") => {
            let call = maybe_break_dispatch_line(&format!(
                "dispatchSync<string | null>('{method}', {dispatch_expr})"
            ));
            format!("const result = {call}\nreturn result === null ? undefined : result")
        }
        Some(other) => {
            return Err(GenError::Parse(format!(
                "bindings.{}.tsWrapper.postProcess unknown {other:?}",
                sym.id
            )))
        }
        None => {
            let stmt = if ret_src == "void" {
                format!("dispatchSync('{method}', {dispatch_expr})")
            } else {
                format!("return dispatchSync('{method}', {dispatch_expr})")
            };
            maybe_break_dispatch_line(&stmt)
        }
    };

    let wrap_list = should_wrap_params(&params_src, export_name, &generics, &ret_src);
    let params_src = if wrap_list && !params_src.contains('\n') {
        wrap_inline_params(&params_src)
    } else {
        params_src
    };
    let one_line_body = body.replace('\n', " ");
    let one_line = format!(
        "export function {export_name}{generics}({}): {ret_src} {{ {one_line_body} }}",
        params_src.trim_end_matches(',')
    );
    let multiline_body = body.contains('\n') || (server && wrap.server_comment.is_some());

    if !wrap_list && !multiline_body && one_line.len() <= PRINT_WIDTH {
        out.push_str(&one_line);
        out.push('\n');
        return Ok(out);
    }

    out.push_str("export function ");
    out.push_str(export_name);
    out.push_str(&generics);
    out.push('(');
    if wrap_list {
        out.push('\n');
        out.push_str(&indent(&params_src, 2));
        out.push('\n');
        out.push_str("): ");
        out.push_str(&ret_src);
        out.push_str(" {\n");
    } else {
        out.push_str(&params_src);
        out.push_str("): ");
        out.push_str(&ret_src);
        out.push_str(" {\n");
    }
    if server {
        if let Some(comment) = wrap.server_comment.as_deref() {
            for line in comment.lines() {
                out.push_str("  // ");
                out.push_str(line);
                out.push('\n');
            }
        }
    }
    for line in body.lines() {
        out.push_str("  ");
        out.push_str(line);
        out.push('\n');
    }
    out.push_str("}\n");
    Ok(out)
}

fn signature_parts(
    ir: &Ir,
    sym: &IrBindingSymbol,
    func: &IrCoreFn,
    wrap: &IrTsWrapper,
    export_name: &str,
    generics: &str,
) -> GenResult<(String, String)> {
    if let Some(sig) = wrap.signature.as_deref() {
        let (params, ret) = split_signature(sig)?;
        return Ok((params, ret));
    }
    let ret = if let Some(ret) = wrap.return_type.clone() {
        ret
    } else {
        map_return(ir, sym, &func.return_ty)?
    };
    let object = wrap.object_param || is_single_named_param(func);
    let parts = if object {
        let p = func.params.first().ok_or_else(|| {
            GenError::Parse(format!(
                "bindings.{} objectParam but scanned fn has no params",
                sym.id
            ))
        })?;
        let name = camel(&p.rust_name);
        let ty = if let Some(over) = wrap.param_types.get(&name) {
            over.clone()
        } else {
            map_object_param_type(ir, p)?
        };
        vec![format!("{name}: {ty}")]
    } else if !sym.args.is_empty() {
        let mut parts = Vec::new();
        for arg in &sym.args {
            parts.push(format_param_from_arg(ir, sym, func, wrap, arg)?);
        }
        parts
    } else {
        let mut parts = Vec::new();
        for p in &func.params {
            let name = camel(&p.rust_name);
            let ty = map_param_ty(ir, sym, &p.ty)?;
            let required = !p.ty.optional;
            parts.push(format_param(wrap, &name, &ty, required));
        }
        parts
    };
    let inline = parts.join(", ");
    let sig_open = format!("export function {export_name}{generics}({inline}): {ret} {{");
    let wrap_params = !parts.is_empty() && sig_open.len() > PRINT_WIDTH;
    let joined = if wrap_params {
        parts
            .iter()
            .map(|p| format!("{p},"))
            .collect::<Vec<_>>()
            .join("\n")
    } else {
        inline
    };
    Ok((joined, ret))
}

fn split_signature(sig: &str) -> GenResult<(String, String)> {
    let sig = sig.trim();
    let Some(idx) = sig.rfind("): ") else {
        return Err(GenError::Parse(format!(
            "tsWrapper.signature must contain `): return`, got {sig:?}"
        )));
    };
    Ok((sig[..idx].to_string(), sig[idx + 3..].trim().to_string()))
}

fn format_param_from_arg(
    ir: &Ir,
    sym: &IrBindingSymbol,
    func: &IrCoreFn,
    wrap: &IrTsWrapper,
    arg: &IrBindingArg,
) -> GenResult<String> {
    if let Some(over) = wrap.param_types.get(&arg.name) {
        return Ok(format!("{}: {over}", arg.name));
    }
    let rust_ty = func
        .params
        .iter()
        .find(|p| camel(&p.rust_name) == arg.name)
        .map(|p| &p.ty);
    let base = if let Some(ty) = rust_ty {
        map_param_ty(ir, sym, ty)?
    } else {
        boundary_ts(arg)
    };
    Ok(format_param(wrap, &arg.name, &base, arg.required))
}

fn format_param(wrap: &IrTsWrapper, name: &str, base: &str, required: bool) -> String {
    if required {
        return format!("{name}: {base}");
    }
    let style = wrap
        .param_style
        .get(name)
        .cloned()
        .or_else(|| wrap.optional_style.clone())
        .unwrap_or_else(|| "nullish".into());
    match style.as_str() {
        "optional" => format!("{name}?: {base}"),
        "optionalNull" => format!("{name}?: {base} | null"),
        "undefined" => format!("{name}: {base} | undefined"),
        _ => format!("{name}: {base} | null | undefined"),
    }
}

fn dispatch_expr(sym: &IrBindingSymbol, func: &IrCoreFn, wrap: &IrTsWrapper) -> GenResult<String> {
    if let Some(args) = wrap.dispatch_args.as_deref() {
        let trimmed = args.trim();
        if trimmed.starts_with('{') {
            return Ok(trimmed.to_string());
        }
        let inner = trimmed
            .lines()
            .map(|line| format!("  {}", line.trim().trim_end_matches(',')))
            .map(|line| {
                if line.ends_with(',') {
                    line
                } else {
                    format!("{line},")
                }
            })
            .collect::<Vec<_>>()
            .join("\n");
        return Ok(format!("{{\n{inner}\n}}"));
    }
    if wrap.pass_through {
        let name = func
            .params
            .first()
            .map(|p| camel(&p.rust_name))
            .unwrap_or_else(|| "input".into());
        return Ok(name);
    }
    if func.params.is_empty() && sym.args.is_empty() {
        return Ok("{}".into());
    }
    let object = wrap.object_param || is_single_named_param(func);
    if object {
        let p = func.params.first().ok_or_else(|| {
            GenError::Parse(format!("bindings.{} object dispatch missing param", sym.id))
        })?;
        let name = camel(&p.rust_name);
        if wrap.pass_through || sym.args.is_empty() || sym.args.iter().all(|a| a.required) {
            return Ok(name);
        }
        return Ok(spread_from_input(&name, &sym.args));
    }
    if sym.args.is_empty() {
        if func.params.is_empty() {
            return Ok("{}".into());
        }
        let mut fields = Vec::new();
        for p in &func.params {
            let n = camel(&p.rust_name);
            if p.ty.optional {
                fields.push(format!("{n}: {n} ?? null"));
            } else {
                fields.push(n);
            }
        }
        return Ok(object_literal(&fields));
    }
    let mut fields = Vec::new();
    for arg in &sym.args {
        if arg.required {
            fields.push(arg.name.clone());
        } else {
            fields.push(format!("{}: {} ?? null", arg.name, arg.name));
        }
    }
    Ok(object_literal(&fields))
}

fn spread_from_input(name: &str, args: &[IrBindingArg]) -> String {
    let fields: Vec<String> = args
        .iter()
        .map(|arg| {
            if arg.required {
                format!("{}: {name}.{}", arg.name, arg.name)
            } else {
                format!("{}: {name}.{} ?? null", arg.name, arg.name)
            }
        })
        .collect();
    object_literal(&fields)
}

fn object_literal(fields: &[String]) -> String {
    if fields.is_empty() {
        return "{}".into();
    }
    format!("{{ {} }}", fields.join(", "))
}

fn should_wrap_params(params_src: &str, export_name: &str, generics: &str, ret_src: &str) -> bool {
    if params_src.is_empty() {
        return false;
    }
    if params_src.contains('\n') {
        return params_src.lines().all(|line| {
            let t = line.trim();
            t.is_empty() || t.ends_with(',')
        });
    }
    let sig_open = format!("export function {export_name}{generics}({params_src}): {ret_src} {{");
    sig_open.len() > PRINT_WIDTH
}

fn wrap_inline_params(params_src: &str) -> String {
    params_src
        .trim_end_matches(',')
        .split(", ")
        .map(|p| format!("{p},"))
        .collect::<Vec<_>>()
        .join("\n")
}

/// Break a too-long `dispatchSync('m', { ... })` call the way Prettier would.
fn maybe_break_dispatch_line(stmt: &str) -> String {
    if stmt.contains('\n') || stmt.len() + 2 <= PRINT_WIDTH {
        return stmt.to_string();
    }
    let Some(idx) = stmt.find(", { ") else {
        return stmt.to_string();
    };
    if !stmt.ends_with(" })") {
        return stmt.to_string();
    }
    let prefix = &stmt[..idx + 2];
    let inner = &stmt[idx + 4..stmt.len() - 3];
    if inner.contains('{') {
        return stmt.to_string();
    }
    let expanded = inner
        .split(", ")
        .map(|f| format!("  {f},"))
        .collect::<Vec<_>>()
        .join("\n");
    format!("{prefix}{{\n{expanded}\n}})")
}

fn is_single_named_param(func: &IrCoreFn) -> bool {
    matches!(
        func.params.as_slice(),
        [IrCoreParam {
            ty: IrCoreParamTy {
                ty: IrCoreFieldTy::Named(_),
                ..
            },
            ..
        }]
    )
}

fn map_object_param_type(ir: &Ir, param: &IrCoreParam) -> GenResult<String> {
    map_param_ty_inner(ir, None, &param.ty)
}

fn map_return(ir: &Ir, sym: &IrBindingSymbol, ty: &IrCoreParamTy) -> GenResult<String> {
    if matches!(&ty.ty, IrCoreFieldTy::Unit) {
        return Ok("void".into());
    }
    let base = map_param_ty(ir, sym, ty)?;
    if ty.optional && !base.ends_with(" | null") && !base.contains('|') {
        return Ok(format!("{base} | null"));
    }
    Ok(base)
}

fn map_param_ty(ir: &Ir, sym: &IrBindingSymbol, ty: &IrCoreParamTy) -> GenResult<String> {
    map_param_ty_inner(ir, Some(sym), ty)
}

fn map_param_ty_inner(
    ir: &Ir,
    sym: Option<&IrBindingSymbol>,
    ty: &IrCoreParamTy,
) -> GenResult<String> {
    match &ty.ty {
        IrCoreFieldTy::Named(name) if name == "HelperErrorResult" => {
            Ok(helper_error_alias(sym).to_string())
        }
        IrCoreFieldTy::Result { .. } => Ok(result_alias(sym)),
        IrCoreFieldTy::Named(name) => Ok(rename_type(ir, name)),
        other => Ok(map_field_ty(ir, other)),
    }
}

fn map_field_ty(ir: &Ir, ty: &IrCoreFieldTy) -> String {
    match ty {
        IrCoreFieldTy::String => "string".into(),
        IrCoreFieldTy::Bool => "boolean".into(),
        IrCoreFieldTy::U16
        | IrCoreFieldTy::U32
        | IrCoreFieldTy::U64
        | IrCoreFieldTy::I64
        | IrCoreFieldTy::F64 => "number".into(),
        IrCoreFieldTy::Value => "unknown".into(),
        IrCoreFieldTy::Unit => "void".into(),
        IrCoreFieldTy::Tuple(elems) => {
            let inner = elems
                .iter()
                .map(|e| map_field_ty(ir, e))
                .collect::<Vec<_>>()
                .join(", ");
            format!("[{inner}]")
        }
        IrCoreFieldTy::Vec(inner) => format!("{}[]", map_field_ty(ir, inner)),
        IrCoreFieldTy::Map(inner) => format!("Record<string, {}>", map_field_ty(ir, inner)),
        IrCoreFieldTy::Named(name) => rename_type(ir, name),
        IrCoreFieldTy::Result { .. } => "unknown".into(),
    }
}

fn rename_type(ir: &Ir, rust_name: &str) -> String {
    ir.core_types_ts
        .rename
        .get(rust_name)
        .cloned()
        .unwrap_or_else(|| rust_name.to_string())
}

fn helper_error_alias(sym: Option<&IrBindingSymbol>) -> &'static str {
    match sym.and_then(|s| s.section.as_deref()) {
        Some("activation") => "ActivatePlanValidationError",
        Some("payment") => "PaymentHelperError",
        Some("checkout") => "CheckoutHelperError",
        Some("limits") => "LimitsHelperError",
        Some("plans") => "PlansHelperError",
        Some("product") => "ProductHelperError",
        Some("renewal") => "RenewalHelperError",
        Some("error") => "RouteErrorResult",
        _ => "ActivatePlanValidationError",
    }
}

fn result_alias(sym: Option<&IrBindingSymbol>) -> String {
    match sym.and_then(|s| s.section.as_deref()) {
        Some("limits") => "CheckLimitsParams | LimitsHelperError".into(),
        Some("renewal") => "Record<string, unknown> | RenewalHelperError".into(),
        Some(PRODUCT_READINESS_SECTION) => "void".into(),
        _ => "unknown".into(),
    }
}

fn boundary_ts(arg: &IrBindingArg) -> String {
    match arg.ty {
        crate::ir::IrBoundaryType::String | crate::ir::IrBoundaryType::StringOpt => "string".into(),
        crate::ir::IrBoundaryType::F64
        | crate::ir::IrBoundaryType::F64Opt
        | crate::ir::IrBoundaryType::I64 => "number".into(),
        crate::ir::IrBoundaryType::Bool => "boolean".into(),
        crate::ir::IrBoundaryType::Value => "unknown".into(),
    }
}

fn camel(snake: &str) -> String {
    let mut out = String::new();
    let mut up = false;
    for c in snake.chars() {
        if c == '_' {
            up = true;
        } else if up {
            out.extend(c.to_uppercase());
            up = false;
        } else {
            out.push(c);
        }
    }
    out
}

fn format_jsdoc(body: &str) -> String {
    let trimmed = body.trim();
    if !trimmed.contains('\n') {
        return format!("/** {trimmed} */\n");
    }
    let mut out = String::from("/**\n");
    for line in trimmed.lines() {
        if line.is_empty() {
            out.push_str(" *\n");
        } else {
            out.push_str(" * ");
            out.push_str(line);
            out.push('\n');
        }
    }
    out.push_str(" */\n");
    out
}

fn indent(src: &str, n: usize) -> String {
    let pad = " ".repeat(n);
    src.lines()
        .map(|l| {
            if l.is_empty() {
                String::new()
            } else {
                format!("{pad}{l}")
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
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

fn chrome_string_array(art: &Value, key: &str) -> GenResult<Vec<String>> {
    let arr = art
        .get(key)
        .and_then(Value::as_array)
        .ok_or_else(|| GenError::Parse(format!("snapshot chrome missing string array {key}")))?;
    let mut out = Vec::with_capacity(arr.len());
    for v in arr {
        let s = v.as_str().ok_or_else(|| {
            GenError::Parse(format!("snapshot chrome {key} contains a non-string"))
        })?;
        out.push(s.to_string());
    }
    Ok(out)
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
mod tests {
    use super::*;

    #[test]
    fn camel_converts_snake() {
        assert_eq!(camel("product_ref"), "productRef");
        assert_eq!(camel("now_ms"), "nowMs");
    }

    #[test]
    fn two_short_params_stay_inline() {
        let src = "status?: string, message?: string";
        assert!(!should_wrap_params(
            src,
            "projectTopupProcessOutcome",
            "",
            "TopupProcessOutcome",
        ));
    }

    #[test]
    fn compact_dispatch_breaks_when_over_print_width() {
        let stmt = "return dispatchSync('validateCheckoutSessionParams', { productRef: productRef ?? null })";
        let out = maybe_break_dispatch_line(stmt);
        if stmt.len() + 2 <= PRINT_WIDTH {
            assert_eq!(out, stmt);
        } else {
            assert!(out.contains("{\n"));
        }
    }
}
