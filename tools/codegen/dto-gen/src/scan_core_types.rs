//! `syn` scanner: `solvapay-core` source text → [`IrCoreType`] values.
//!
//! Syntactic only — aliases and re-exports are invisible. Selection happens
//! later via the transitive closure of named types on `#[solvapay_export]`
//! signatures.

use syn::punctuated::Punctuated;
use syn::{
    parse_file, Attribute, Fields, FnArg, GenericArgument, ImplItem, Item, ItemEnum, ItemFn,
    ItemImpl, ItemStruct, Meta, Pat, PathArguments, ReturnType, Type, TypePath, Variant,
};

use crate::error::{GenError, GenResult};
use crate::ir::{
    IrCoreField, IrCoreFieldTy, IrCoreFn, IrCoreParam, IrCoreParamTy, IrCoreSerde, IrCoreShape,
    IrCoreType, IrCoreVariant, IrExportAttr,
};

/// Types and functions extracted from one file (or snippet).
#[derive(Debug, Default)]
pub struct CoreScan {
    /// Structs and enums.
    pub types: Vec<IrCoreType>,
    /// `pub fn` items.
    pub fns: Vec<IrCoreFn>,
}

/// Parse one Rust source file (or snippet) into core struct/enum IR.
///
/// `module` is the `solvapay-core` module path (`customer_sync`, `mcp::envelope`).
///
/// # Errors
///
/// Returns [`GenError::Parse`] when the source is not valid Rust, or
/// [`GenError::Unsupported`] for serde/type shapes the scanner cannot represent.
pub fn scan_core_types(src: &str, module: &str) -> GenResult<Vec<IrCoreType>> {
    Ok(scan_core_file(src, module, false)?.types)
}

/// Parse types and `pub fn` signatures from one file.
///
/// # Errors
///
/// Parse or unsupported-shape failures.
pub fn scan_core_file(src: &str, module: &str, skip_unsupported: bool) -> GenResult<CoreScan> {
    let file = parse_file(src).map_err(|e| GenError::Parse(format!("syn parse error: {e}")))?;
    let mut out = CoreScan::default();
    walk_items(&file.items, module, skip_unsupported, &mut out)?;
    Ok(out)
}

/// Parse types and `pub fn` signatures from one file, skipping unsupported items.
pub(crate) fn scan_core_file_skipping_unsupported(src: &str, module: &str) -> GenResult<CoreScan> {
    scan_core_file(src, module, true)
}

fn walk_items(
    items: &[Item],
    module: &str,
    skip_unsupported: bool,
    out: &mut CoreScan,
) -> GenResult<()> {
    for item in items {
        let attrs = item_attrs(item);
        if cfg_is_test(attrs) {
            continue;
        }
        match item {
            Item::Struct(item) if is_pub(&item.vis) => {
                push_or_skip_type(scan_struct(item, module), skip_unsupported, out)?;
            }
            Item::Enum(item) if is_pub(&item.vis) => {
                push_or_skip_type(scan_enum(item, module), skip_unsupported, out)?;
            }
            Item::Fn(item) if is_pub(&item.vis) => {
                push_or_skip_fn(scan_fn(item, module, None), skip_unsupported, out)?;
            }
            Item::Impl(item) => {
                scan_inherent_impl(item, module, skip_unsupported, out)?;
            }
            Item::Mod(item) => {
                if let Some((_, nested)) = &item.content {
                    let child = if module.is_empty() {
                        item.ident.to_string()
                    } else {
                        format!("{module}::{}", item.ident)
                    };
                    walk_items(nested, &child, skip_unsupported, out)?;
                }
            }
            _ => {}
        }
    }
    Ok(())
}

fn push_or_skip_type(
    result: GenResult<IrCoreType>,
    skip_unsupported: bool,
    out: &mut CoreScan,
) -> GenResult<()> {
    match result {
        Ok(ty) => {
            out.types.push(ty);
            Ok(())
        }
        Err(GenError::Unsupported { .. }) if skip_unsupported => Ok(()),
        Err(err) => Err(err),
    }
}

fn push_or_skip_fn(
    result: GenResult<IrCoreFn>,
    skip_unsupported: bool,
    out: &mut CoreScan,
) -> GenResult<()> {
    match result {
        Ok(func) => {
            out.fns.push(func);
            Ok(())
        }
        Err(GenError::Unsupported { .. }) if skip_unsupported => Ok(()),
        Err(err) => Err(err),
    }
}

fn is_pub(vis: &syn::Visibility) -> bool {
    matches!(vis, syn::Visibility::Public(_))
}

fn item_attrs(item: &Item) -> &[Attribute] {
    match item {
        Item::Struct(s) => &s.attrs,
        Item::Enum(e) => &e.attrs,
        Item::Mod(m) => &m.attrs,
        Item::Fn(f) => &f.attrs,
        Item::Use(u) => &u.attrs,
        Item::Const(c) => &c.attrs,
        Item::Static(s) => &s.attrs,
        Item::Impl(i) => &i.attrs,
        Item::Trait(t) => &t.attrs,
        Item::Type(t) => &t.attrs,
        _ => &[],
    }
}

fn scan_struct(item: &ItemStruct, module: &str) -> GenResult<IrCoreType> {
    let serde_attrs = SerdeAttrs::parse(&item.attrs, &item.ident.to_string())?;
    let fields = match &item.fields {
        Fields::Named(named) => scan_named_fields(&named.named, serde_attrs.rename_all.as_deref())?,
        Fields::Unit => Vec::new(),
        Fields::Unnamed(_) => {
            return Err(GenError::Unsupported {
                name: item.ident.to_string(),
                detail: "tuple structs are not supported".into(),
            });
        }
    };
    Ok(IrCoreType {
        name: item.ident.to_string(),
        module: module.to_owned(),
        rustdoc: rustdoc(&item.attrs),
        serde: serde_derives(&item.attrs),
        cfg_feature: cfg_feature(&item.attrs),
        shape: IrCoreShape::Struct {
            rename_all: serde_attrs.rename_all,
            fields,
        },
    })
}

fn scan_enum(item: &ItemEnum, module: &str) -> GenResult<IrCoreType> {
    let serde_attrs = SerdeAttrs::parse(&item.attrs, &item.ident.to_string())?;
    let mut variants = Vec::with_capacity(item.variants.len());
    let mut all_unit = true;
    for variant in &item.variants {
        let scanned = scan_variant(variant, serde_attrs.rename_all.as_deref())?;
        if !scanned.fields.is_empty() {
            all_unit = false;
        }
        variants.push(scanned);
    }
    let shape = if serde_attrs.untagged {
        IrCoreShape::UntaggedEnum {
            rename_all: serde_attrs.rename_all,
            variants,
        }
    } else if let Some(tag) = serde_attrs.tag {
        IrCoreShape::TaggedEnum {
            tag,
            rename_all: serde_attrs.rename_all,
            variants,
        }
    } else if all_unit {
        IrCoreShape::UnitEnum {
            rename_all: serde_attrs.rename_all,
            variants,
        }
    } else {
        return Err(GenError::Unsupported {
            name: item.ident.to_string(),
            detail: "data-carrying enum must be #[serde(tag = ...)] or #[serde(untagged)]".into(),
        });
    };
    Ok(IrCoreType {
        name: item.ident.to_string(),
        module: module.to_owned(),
        rustdoc: rustdoc(&item.attrs),
        serde: serde_derives(&item.attrs),
        cfg_feature: cfg_feature(&item.attrs),
        shape,
    })
}

fn scan_variant(variant: &Variant, rename_all: Option<&str>) -> GenResult<IrCoreVariant> {
    let serde_attrs = SerdeAttrs::parse(&variant.attrs, &variant.ident.to_string())?;
    let rust_name = variant.ident.to_string();
    let wire_name = serde_attrs
        .rename
        .unwrap_or_else(|| apply_rename_all(&rust_name, rename_all));
    let fields = match &variant.fields {
        Fields::Named(named) => scan_named_fields(
            &named.named,
            serde_attrs.rename_all.as_deref().or(rename_all),
        )?,
        Fields::Unit => Vec::new(),
        Fields::Unnamed(_) => {
            return Err(GenError::Unsupported {
                name: rust_name,
                detail: "tuple enum variants are not supported".into(),
            });
        }
    };
    Ok(IrCoreVariant {
        rust_name,
        wire_name,
        rustdoc: rustdoc(&variant.attrs),
        fields,
        cfg_feature: cfg_feature(&variant.attrs),
    })
}

fn scan_named_fields(
    fields: &Punctuated<syn::Field, syn::token::Comma>,
    rename_all: Option<&str>,
) -> GenResult<Vec<IrCoreField>> {
    let mut out = Vec::with_capacity(fields.len());
    for field in fields {
        let rust_name = field
            .ident
            .as_ref()
            .ok_or_else(|| GenError::Parse("anonymous struct field".into()))?
            .to_string();
        let serde_attrs = SerdeAttrs::parse(&field.attrs, &rust_name)?;
        if serde_attrs.skip {
            continue;
        }
        let (optional, ty) = map_field_type(&field.ty, &rust_name)?;
        out.push(IrCoreField {
            wire_name: serde_attrs
                .rename
                .unwrap_or_else(|| apply_rename_all(&rust_name, rename_all)),
            rust_name,
            rustdoc: rustdoc(&field.attrs),
            optional,
            skip_serializing_if: serde_attrs.skip_serializing_if,
            serde_default: serde_attrs.default,
            serialize_with: serde_attrs.serialize_with,
            cfg_feature: cfg_feature(&field.attrs),
            ty,
        });
    }
    Ok(out)
}

fn scan_inherent_impl(
    item: &ItemImpl,
    module: &str,
    skip_unsupported: bool,
    out: &mut CoreScan,
) -> GenResult<()> {
    if item.trait_.is_some() || cfg_is_test(&item.attrs) {
        return Ok(());
    }
    if !item.generics.params.is_empty() {
        return Ok(());
    }
    let Some(ty_name) = impl_type_name(&item.self_ty) else {
        return Ok(());
    };
    for impl_item in &item.items {
        let ImplItem::Fn(method) = impl_item else {
            continue;
        };
        if !is_pub(&method.vis) {
            continue;
        }
        if cfg_is_test(&method.attrs) {
            continue;
        }
        push_or_skip_fn(
            scan_method(&method, module, &ty_name),
            skip_unsupported,
            out,
        )?;
    }
    Ok(())
}

fn impl_type_name(ty: &Type) -> Option<String> {
    let Type::Path(TypePath { qself: None, path }) = ty else {
        return None;
    };
    path.segments.last().map(|s| s.ident.to_string())
}

fn scan_method(item: &syn::ImplItemFn, module: &str, impl_ty: &str) -> GenResult<IrCoreFn> {
    scan_sig(&item.sig, &item.attrs, module, Some(impl_ty.to_owned()))
}

fn scan_fn(item: &ItemFn, module: &str, impl_ty: Option<String>) -> GenResult<IrCoreFn> {
    scan_sig(&item.sig, &item.attrs, module, impl_ty)
}

fn scan_sig(
    sig: &syn::Signature,
    attrs: &[Attribute],
    module: &str,
    impl_ty: Option<String>,
) -> GenResult<IrCoreFn> {
    if !sig.generics.params.is_empty() {
        return Err(GenError::Unsupported {
            name: sig.ident.to_string(),
            detail: "generic functions are not scanned".into(),
        });
    }
    let mut params = Vec::new();
    for input in &sig.inputs {
        match input {
            FnArg::Receiver(_) => {}
            FnArg::Typed(pat) => {
                let rust_name = match &*pat.pat {
                    Pat::Ident(ident) => ident.ident.to_string(),
                    Pat::Wild(_) => "_".into(),
                    _ => {
                        return Err(GenError::Unsupported {
                            name: sig.ident.to_string(),
                            detail: "unsupported parameter pattern".into(),
                        });
                    }
                };
                params.push(map_param(&pat.ty, &rust_name)?);
            }
        }
    }
    let return_ty = match &sig.output {
        ReturnType::Default => IrCoreParamTy {
            optional: false,
            ty: IrCoreFieldTy::Unit,
        },
        ReturnType::Type(_, ty) => map_return(ty, &sig.ident.to_string())?,
    };
    Ok(IrCoreFn {
        name: sig.ident.to_string(),
        module: module.to_owned(),
        impl_ty,
        crate_name: String::new(),
        rustdoc: rustdoc(attrs),
        params,
        return_ty,
        exported: parse_export_attr(attrs)?,
        is_async: sig.asyncness.is_some(),
    })
}

fn map_param(ty: &Type, name: &str) -> GenResult<IrCoreParam> {
    let by_ref = type_is_ref(ty);
    let (optional, inner) = unwrap_option(ty);
    Ok(IrCoreParam {
        rust_name: name.to_owned(),
        by_ref,
        ty: IrCoreParamTy {
            optional,
            ty: map_type(inner, name)?,
        },
    })
}

fn map_return(ty: &Type, name: &str) -> GenResult<IrCoreParamTy> {
    let (optional, inner) = unwrap_option(ty);
    Ok(IrCoreParamTy {
        optional,
        ty: map_type(inner, name)?,
    })
}

fn unwrap_option(ty: &Type) -> (bool, &Type) {
    if let Some(inner) = option_inner(ty) {
        (true, inner)
    } else {
        (false, ty)
    }
}

fn type_is_ref(ty: &Type) -> bool {
    match ty {
        Type::Reference(_) => true,
        Type::Slice(_) => true,
        other => option_inner(other).is_some_and(type_is_ref),
    }
}

fn map_field_type(ty: &Type, field: &str) -> GenResult<(bool, IrCoreFieldTy)> {
    if let Some(inner) = option_inner(ty) {
        return Ok((true, map_type(inner, field)?));
    }
    Ok((false, map_type(ty, field)?))
}

fn option_inner(ty: &Type) -> Option<&Type> {
    let Type::Path(TypePath { qself: None, path }) = ty else {
        return None;
    };
    let last = path.segments.last()?;
    if last.ident != "Option" {
        return None;
    }
    first_generic(Some(&last.arguments), "", "Option").ok()
}

fn map_type(ty: &Type, field: &str) -> GenResult<IrCoreFieldTy> {
    match ty {
        Type::Reference(inner) => map_type(&inner.elem, field),
        Type::Slice(inner) => Ok(IrCoreFieldTy::Vec(Box::new(map_type(&inner.elem, field)?))),
        Type::Paren(inner) => map_type(&inner.elem, field),
        Type::Tuple(tuple) if tuple.elems.is_empty() => Ok(IrCoreFieldTy::Unit),
        Type::Tuple(tuple) => {
            let mut elems = Vec::new();
            for elem in &tuple.elems {
                elems.push(map_type(elem, field)?);
            }
            Ok(IrCoreFieldTy::Tuple(elems))
        }
        Type::Path(TypePath { qself: None, path }) => map_path_type(path, field),
        _ => Err(GenError::Unsupported {
            name: field.to_owned(),
            detail: format!("unsupported type syntax: {}", quote_type(ty)),
        }),
    }
}

fn map_path_type(path: &syn::Path, field: &str) -> GenResult<IrCoreFieldTy> {
    let ident = last_ident(path)?;
    let args = last_generic_args(path);
    match ident.as_str() {
        "Vec" => {
            let inner = first_generic(args, field, "Vec")?;
            Ok(IrCoreFieldTy::Vec(Box::new(map_type(inner, field)?)))
        }
        "Map" | "BTreeMap" => {
            let (key, value) = map_generics(args, field, &ident)?;
            let key_ty = map_type(key, field)?;
            if key_ty != IrCoreFieldTy::String {
                return Err(GenError::Unsupported {
                    name: field.to_owned(),
                    detail: format!("{ident} key must be String"),
                });
            }
            Ok(IrCoreFieldTy::Map(Box::new(map_type(value, field)?)))
        }
        "Box" => {
            let inner = first_generic(args, field, "Box")?;
            map_type(inner, field)
        }
        "String" | "str" => Ok(IrCoreFieldTy::String),
        "bool" => Ok(IrCoreFieldTy::Bool),
        "u16" => Ok(IrCoreFieldTy::U16),
        "u32" => Ok(IrCoreFieldTy::U32),
        "u64" => Ok(IrCoreFieldTy::U64),
        "i64" => Ok(IrCoreFieldTy::I64),
        "f64" => Ok(IrCoreFieldTy::F64),
        "Value" => Ok(IrCoreFieldTy::Value),
        "Result" => {
            let (ok, err) = map_generics(args, field, "Result")?;
            Ok(IrCoreFieldTy::Result {
                ok: Box::new(map_type(ok, field)?),
                err: Box::new(map_type(err, field)?),
            })
        }
        other => Ok(IrCoreFieldTy::Named(other.to_owned())),
    }
}

fn last_ident(path: &syn::Path) -> GenResult<String> {
    path.segments
        .last()
        .map(|s| s.ident.to_string())
        .ok_or_else(|| GenError::Parse("empty type path".into()))
}

fn last_generic_args(path: &syn::Path) -> Option<&PathArguments> {
    path.segments.last().map(|s| &s.arguments)
}

fn first_generic<'a>(
    args: Option<&'a PathArguments>,
    field: &str,
    wrapper: &str,
) -> GenResult<&'a Type> {
    let PathArguments::AngleBracketed(angle) = args.ok_or_else(|| GenError::Unsupported {
        name: field.to_owned(),
        detail: format!("{wrapper} missing generic arguments"),
    })?
    else {
        return Err(GenError::Unsupported {
            name: field.to_owned(),
            detail: format!("{wrapper} missing generic arguments"),
        });
    };
    angle
        .args
        .iter()
        .find_map(|arg| match arg {
            GenericArgument::Type(ty) => Some(ty),
            _ => None,
        })
        .ok_or_else(|| GenError::Unsupported {
            name: field.to_owned(),
            detail: format!("{wrapper} missing type argument"),
        })
}

fn map_generics<'a>(
    args: Option<&'a PathArguments>,
    field: &str,
    wrapper: &str,
) -> GenResult<(&'a Type, &'a Type)> {
    let PathArguments::AngleBracketed(angle) = args.ok_or_else(|| GenError::Unsupported {
        name: field.to_owned(),
        detail: format!("{wrapper} missing generic arguments"),
    })?
    else {
        return Err(GenError::Unsupported {
            name: field.to_owned(),
            detail: format!("{wrapper} missing generic arguments"),
        });
    };
    let types: Vec<&Type> = angle
        .args
        .iter()
        .filter_map(|arg| match arg {
            GenericArgument::Type(ty) => Some(ty),
            _ => None,
        })
        .collect();
    if types.len() != 2 {
        return Err(GenError::Unsupported {
            name: field.to_owned(),
            detail: format!("{wrapper} needs two type arguments"),
        });
    }
    Ok((types[0], types[1]))
}

fn quote_type(_ty: &Type) -> String {
    "non-path type".to_owned()
}

fn export_attr_ident(attr: &Attribute) -> bool {
    attr.path()
        .segments
        .last()
        .is_some_and(|seg| seg.ident == "solvapay_export")
}

fn parse_export_attr(attrs: &[Attribute]) -> GenResult<Option<IrExportAttr>> {
    let mut found = None;
    for attr in attrs {
        if !export_attr_ident(attr) {
            continue;
        }
        if found.is_some() {
            return Err(GenError::Parse(
                "duplicate #[solvapay_export] on the same item".into(),
            ));
        }
        found = Some(parse_export_args(attr)?);
    }
    Ok(found)
}

fn parse_export_args(attr: &Attribute) -> GenResult<IrExportAttr> {
    match &attr.meta {
        Meta::Path(_) => Ok(IrExportAttr::default()),
        Meta::List(list) => {
            let metas = list
                .parse_args_with(Punctuated::<Meta, syn::Token![,]>::parse_terminated)
                .map_err(|e| GenError::Parse(format!("#[solvapay_export] args: {e}")))?;
            let mut out = IrExportAttr::default();
            for meta in metas {
                match meta {
                    Meta::NameValue(nv) => apply_export_name_value(&mut out, &nv)?,
                    Meta::Path(path) => {
                        return Err(GenError::Parse(format!(
                            "#[solvapay_export]: unknown key {}",
                            path_last(&path)
                        )));
                    }
                    Meta::List(inner) => {
                        return Err(GenError::Parse(format!(
                            "#[solvapay_export]: unknown key {}",
                            path_last(&inner.path)
                        )));
                    }
                }
            }
            Ok(out)
        }
        Meta::NameValue(_) => Err(GenError::Parse(
            "#[solvapay_export] does not take a name-value form".into(),
        )),
    }
}

fn path_last(path: &syn::Path) -> String {
    path.segments
        .last()
        .map(|s| s.ident.to_string())
        .unwrap_or_default()
}

fn apply_export_name_value(out: &mut IrExportAttr, nv: &syn::MetaNameValue) -> GenResult<()> {
    let key = path_last(&nv.path);
    match key.as_str() {
        "id" => out.id = Some(export_lit_str(&nv.value, &key)?),
        "artifact" => out.artifact = Some(export_lit_str(&nv.value, &key)?),
        "catalog" => out.catalog = Some(export_lit_str(&nv.value, &key)?),
        "section" => out.section = Some(export_lit_str(&nv.value, &key)?),
        "sync" => out.sync = Some(export_lit_str(&nv.value, &key)?),
        "envelope" => out.envelope = Some(export_lit_str(&nv.value, &key)?),
        "rust_fn_name" => out.rust_fn_name = Some(export_lit_str(&nv.value, &key)?),
        "emit_order" => out.emit_order = Some(export_lit_int(&nv.value, &key)?),
        "host_injected" => {
            out.host_injected = split_csv(&export_lit_str(&nv.value, &key)?);
        }
        "typed_as" => {
            out.typed_as = parse_colon_map(&export_lit_str(&nv.value, &key)?, &key)?;
        }
        "typed_style" => {
            out.typed_style = parse_colon_map(&export_lit_str(&nv.value, &key)?, &key)?;
        }
        "extract" => {
            out.extract = parse_colon_map(&export_lit_str(&nv.value, &key)?, &key)?;
        }
        "local" => {
            out.local = parse_colon_map(&export_lit_str(&nv.value, &key)?, &key)?;
        }
        "rename" => {
            out.rename = parse_colon_map(&export_lit_str(&nv.value, &key)?, &key)?;
        }
        "dto_type" => out.dto_type = Some(export_lit_str(&nv.value, &key)?),
        "split_path_refs" => {
            out.split_path_refs = split_csv(&export_lit_str(&nv.value, &key)?);
        }
        other => {
            return Err(GenError::Parse(format!(
                "#[solvapay_export]: unknown key {other}"
            )));
        }
    }
    Ok(())
}

fn split_csv(raw: &str) -> Vec<String> {
    raw.split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn parse_colon_map(raw: &str, key: &str) -> GenResult<std::collections::BTreeMap<String, String>> {
    let mut out = std::collections::BTreeMap::new();
    for part in split_csv(raw) {
        let Some((name, ty)) = part.split_once(':') else {
            return Err(GenError::Parse(format!(
                "#[solvapay_export] {key}: expected name:Type, got {part:?}"
            )));
        };
        out.insert(name.trim().to_owned(), ty.trim().to_owned());
    }
    Ok(out)
}

fn export_lit_str(expr: &syn::Expr, key: &str) -> GenResult<String> {
    let syn::Expr::Lit(syn::ExprLit {
        lit: syn::Lit::Str(lit),
        ..
    }) = expr
    else {
        return Err(GenError::Parse(format!(
            "#[solvapay_export] {key} must be a string literal"
        )));
    };
    Ok(lit.value())
}

fn export_lit_int(expr: &syn::Expr, key: &str) -> GenResult<u32> {
    let syn::Expr::Lit(syn::ExprLit {
        lit: syn::Lit::Int(lit),
        ..
    }) = expr
    else {
        return Err(GenError::Parse(format!(
            "#[solvapay_export] {key} must be an integer literal"
        )));
    };
    lit.base10_parse::<u32>()
        .map_err(|e| GenError::Parse(format!("#[solvapay_export] {key}: {e}")))
}

fn rustdoc(attrs: &[Attribute]) -> String {
    let mut lines = Vec::new();
    for attr in attrs {
        if !attr.path().is_ident("doc") {
            continue;
        }
        let Meta::NameValue(nv) = &attr.meta else {
            continue;
        };
        let syn::Expr::Lit(syn::ExprLit {
            lit: syn::Lit::Str(lit),
            ..
        }) = &nv.value
        else {
            continue;
        };
        let value = lit.value();
        lines.push(value.strip_prefix(' ').unwrap_or(&value).to_owned());
    }
    lines.join("\n")
}

fn serde_derives(attrs: &[Attribute]) -> IrCoreSerde {
    let mut serialize = false;
    let mut deserialize = false;
    for attr in attrs {
        if !attr.path().is_ident("derive") {
            continue;
        }
        let Meta::List(list) = &attr.meta else {
            continue;
        };
        let Ok(nested) = list.parse_args_with(Punctuated::<Meta, syn::Token![,]>::parse_terminated)
        else {
            continue;
        };
        for meta in nested {
            let ident = meta.path().segments.last().map(|s| s.ident.to_string());
            match ident.as_deref() {
                Some("Serialize") => serialize = true,
                Some("Deserialize") => deserialize = true,
                _ => {}
            }
        }
    }
    match (serialize, deserialize) {
        (true, true) => IrCoreSerde::Both,
        (true, false) => IrCoreSerde::Serialize,
        (false, true) => IrCoreSerde::Deserialize,
        (false, false) => IrCoreSerde::None,
    }
}

fn cfg_is_test(attrs: &[Attribute]) -> bool {
    attrs.iter().any(|attr| {
        if !attr.path().is_ident("cfg") {
            return false;
        }
        let Meta::List(list) = &attr.meta else {
            return false;
        };
        list.parse_args::<syn::Ident>()
            .map(|id| id == "test")
            .unwrap_or(false)
    })
}

fn cfg_feature(attrs: &[Attribute]) -> Option<String> {
    for attr in attrs {
        if !attr.path().is_ident("cfg") {
            continue;
        }
        let Meta::List(list) = &attr.meta else {
            continue;
        };
        if let Ok(Meta::NameValue(nv)) = list.parse_args::<Meta>() {
            if nv.path.is_ident("feature") {
                if let syn::Expr::Lit(syn::ExprLit {
                    lit: syn::Lit::Str(lit),
                    ..
                }) = nv.value
                {
                    return Some(lit.value());
                }
            }
        }
    }
    None
}

#[derive(Default)]
struct SerdeAttrs {
    rename_all: Option<String>,
    rename: Option<String>,
    tag: Option<String>,
    untagged: bool,
    skip: bool,
    default: bool,
    skip_serializing_if: Option<String>,
    serialize_with: Option<String>,
}

impl SerdeAttrs {
    fn parse(attrs: &[Attribute], name: &str) -> GenResult<Self> {
        let mut out = Self::default();
        for attr in attrs {
            if !attr.path().is_ident("serde") {
                continue;
            }
            let Meta::List(list) = &attr.meta else {
                continue;
            };
            let nested = list
                .parse_args_with(Punctuated::<Meta, syn::Token![,]>::parse_terminated)
                .map_err(|e| GenError::Parse(format!("{name}: serde attr: {e}")))?;
            for meta in nested {
                match meta {
                    Meta::Path(path) if path.is_ident("untagged") => out.untagged = true,
                    Meta::Path(path) if path.is_ident("default") => out.default = true,
                    Meta::Path(path) if path.is_ident("skip") => out.skip = true,
                    Meta::Path(path) if path.is_ident("flatten") => {
                        return Err(GenError::Unsupported {
                            name: name.to_owned(),
                            detail: "#[serde(flatten)] is not supported".into(),
                        });
                    }
                    Meta::NameValue(nv) if nv.path.is_ident("rename_all") => {
                        out.rename_all = Some(lit_str(&nv.value, name, "rename_all")?);
                    }
                    Meta::NameValue(nv) if nv.path.is_ident("rename") => {
                        out.rename = Some(lit_str(&nv.value, name, "rename")?);
                    }
                    Meta::NameValue(nv) if nv.path.is_ident("tag") => {
                        out.tag = Some(lit_str(&nv.value, name, "tag")?);
                    }
                    Meta::NameValue(nv) if nv.path.is_ident("skip_serializing_if") => {
                        out.skip_serializing_if =
                            Some(lit_str(&nv.value, name, "skip_serializing_if")?);
                    }
                    Meta::NameValue(nv) if nv.path.is_ident("serialize_with") => {
                        out.serialize_with = Some(lit_str(&nv.value, name, "serialize_with")?);
                    }
                    _ => {}
                }
            }
        }
        if let Some(convention) = out.rename_all.as_deref() {
            validate_rename_all(convention, name)?;
        }
        Ok(out)
    }
}

fn validate_rename_all(convention: &str, name: &str) -> GenResult<()> {
    match convention {
        "camelCase" | "snake_case" | "SCREAMING_SNAKE_CASE" => Ok(()),
        other => Err(GenError::Unsupported {
            name: name.to_owned(),
            detail: format!("unsupported serde rename_all = {other:?}"),
        }),
    }
}

fn lit_str(expr: &syn::Expr, name: &str, key: &str) -> GenResult<String> {
    let syn::Expr::Lit(syn::ExprLit {
        lit: syn::Lit::Str(lit),
        ..
    }) = expr
    else {
        return Err(GenError::Parse(format!(
            "{name}: serde {key} must be a string"
        )));
    };
    Ok(lit.value())
}

fn apply_rename_all(ident: &str, convention: Option<&str>) -> String {
    match convention {
        None => ident.to_owned(),
        Some("camelCase") => to_camel_case(ident),
        Some("snake_case") => to_snake_case(ident),
        Some("SCREAMING_SNAKE_CASE") => to_snake_case(ident).to_ascii_uppercase(),
        Some(_) => ident.to_owned(),
    }
}

fn ident_words(ident: &str) -> Vec<String> {
    let chars: Vec<char> = ident.chars().collect();
    let mut words = Vec::new();
    let mut current = String::new();
    for (i, c) in chars.iter().copied().enumerate() {
        if c == '_' || c == '-' {
            if !current.is_empty() {
                words.push(std::mem::take(&mut current));
            }
            continue;
        }
        if c.is_uppercase() && !current.is_empty() {
            let prev_lower = i
                .checked_sub(1)
                .and_then(|j| chars.get(j))
                .is_some_and(|p| p.is_lowercase() || p.is_ascii_digit());
            let next_lower = chars.get(i + 1).is_some_and(|n| n.is_lowercase());
            if prev_lower || next_lower {
                words.push(std::mem::take(&mut current));
            }
        }
        current.push(c);
    }
    if !current.is_empty() {
        words.push(current);
    }
    words
}

fn to_snake_case(ident: &str) -> String {
    ident_words(ident)
        .into_iter()
        .map(|w| w.to_ascii_lowercase())
        .collect::<Vec<_>>()
        .join("_")
}

fn to_camel_case(ident: &str) -> String {
    let words = ident_words(ident);
    let mut out = String::new();
    for (i, word) in words.iter().enumerate() {
        let lower = word.to_ascii_lowercase();
        if i == 0 {
            out.push_str(&lower);
        } else {
            let mut chars = lower.chars();
            if let Some(first) = chars.next() {
                out.extend(first.to_uppercase());
                out.extend(chars);
            }
        }
    }
    out
}

/// Named type references reachable from a core type (for transitive closure).
pub fn named_refs(ty: &IrCoreType) -> Vec<String> {
    let mut names = Vec::new();
    match &ty.shape {
        IrCoreShape::Struct { fields, .. } => {
            for field in fields {
                collect_named(&field.ty, &mut names);
            }
        }
        IrCoreShape::UnitEnum { .. } => {}
        IrCoreShape::TaggedEnum { variants, .. } | IrCoreShape::UntaggedEnum { variants, .. } => {
            for variant in variants {
                for field in &variant.fields {
                    collect_named(&field.ty, &mut names);
                }
            }
        }
    }
    names
}

/// Named type references reachable from a function parameter / return type.
pub fn named_refs_in_field_ty(ty: &IrCoreFieldTy) -> Vec<String> {
    let mut names = Vec::new();
    collect_named(ty, &mut names);
    names
}

fn collect_named(ty: &IrCoreFieldTy, names: &mut Vec<String>) {
    match ty {
        IrCoreFieldTy::Named(name) => names.push(name.clone()),
        IrCoreFieldTy::Vec(inner) | IrCoreFieldTy::Map(inner) => collect_named(inner, names),
        IrCoreFieldTy::Tuple(elems) => {
            for elem in elems {
                collect_named(elem, names);
            }
        }
        IrCoreFieldTy::Result { ok, err } => {
            collect_named(ok, names);
            collect_named(err, names);
        }
        IrCoreFieldTy::Unit
        | IrCoreFieldTy::String
        | IrCoreFieldTy::Bool
        | IrCoreFieldTy::U16
        | IrCoreFieldTy::U32
        | IrCoreFieldTy::U64
        | IrCoreFieldTy::I64
        | IrCoreFieldTy::F64
        | IrCoreFieldTy::Value => {}
    }
}

#[cfg(test)]
mod tests {
    #![allow(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::panic,
        clippy::missing_docs_in_private_items
    )]

    use super::*;

    fn struct_named<'a>(types: &'a [IrCoreType], name: &str) -> &'a IrCoreType {
        types.iter().find(|t| t.name == name).expect("type present")
    }

    fn fields_of(ty: &IrCoreType) -> &[IrCoreField] {
        match &ty.shape {
            IrCoreShape::Struct { fields, .. } => fields,
            _ => panic!("expected struct"),
        }
    }

    fn field<'a>(ty: &'a IrCoreType, rust_name: &str) -> &'a IrCoreField {
        fields_of(ty)
            .iter()
            .find(|f| f.rust_name == rust_name)
            .expect("field")
    }

    #[test]
    fn extracts_coerced_customer_options() {
        let src = r#"
/// Coerced email/name options (`null`/`''` → omitted).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct CoercedCustomerOptions {
    /// Email when non-empty.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    /// Name when non-empty.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}
"#;
        let types = scan_core_types(src, "customer_sync").unwrap();
        let ty = struct_named(&types, "CoercedCustomerOptions");
        assert_eq!(ty.module, "customer_sync");
        assert_eq!(
            ty.rustdoc,
            "Coerced email/name options (`null`/`''` → omitted)."
        );
        assert_eq!(ty.serde, IrCoreSerde::Both);
        let email = field(ty, "email");
        assert_eq!(email.wire_name, "email");
        assert!(email.optional);
        assert_eq!(
            email.skip_serializing_if.as_deref(),
            Some("Option::is_none")
        );
        assert_eq!(email.ty, IrCoreFieldTy::String);
        let name = field(ty, "name");
        assert_eq!(name.wire_name, "name");
        assert!(name.optional);
    }

    #[test]
    fn extracts_create_customer_params_camel_case() {
        let src = r#"
/// createCustomer request params.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCustomerParams {
    /// Email (provided or generated fallback).
    pub email: String,
    /// Optional display name.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Optional external reference.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub external_ref: Option<String>,
    /// Always `{}` today.
    pub metadata: Map<String, Value>,
}
"#;
        let types = scan_core_types(src, "customer_sync").unwrap();
        let ty = struct_named(&types, "CreateCustomerParams");
        assert_eq!(field(ty, "external_ref").wire_name, "externalRef");
        assert!(field(ty, "external_ref").optional);
        assert_eq!(field(ty, "email").wire_name, "email");
        assert!(!field(ty, "email").optional);
        assert_eq!(
            field(ty, "metadata").ty,
            IrCoreFieldTy::Map(Box::new(IrCoreFieldTy::Value))
        );
    }

    #[test]
    fn records_absent_serde_on_payment_intent_source() {
        let src = r#"
/// Source fields from a create-PI / create-topup client response.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PaymentIntentSource {
    /// Processor payment id.
    pub processor_payment_id: String,
    /// Client secret.
    pub client_secret: String,
    /// Publishable key.
    pub publishable_key: String,
    /// Optional connected account id.
    pub account_id: Option<String>,
}
"#;
        let types = scan_core_types(src, "payment").unwrap();
        let ty = struct_named(&types, "PaymentIntentSource");
        assert_eq!(ty.serde, IrCoreSerde::None);
        assert_eq!(
            field(ty, "processor_payment_id").wire_name,
            "processor_payment_id"
        );
        assert!(field(ty, "account_id").optional);
    }

    #[test]
    fn rename_all_snake_and_screaming_and_field_override() {
        let src = r#"
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PaywallGateKind {
    PaymentRequired,
    ActivationRequired,
}

#[derive(Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub struct McpViewMaps {
    pub tool_for_view: Map<String, Value>,
    pub view_for_tool: Map<String, Value>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaywallPlanSummary {
    pub reference: String,
    #[serde(rename = "type")]
    pub plan_type: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResponseEnvelope {
    #[serde(rename = "__solvapayResponse")]
    pub solvapay_response: bool,
    pub data: Value,
}
"#;
        let types = scan_core_types(src, "mix").unwrap();
        let kind = types.iter().find(|t| t.name == "PaywallGateKind").unwrap();
        match &kind.shape {
            IrCoreShape::UnitEnum { variants, .. } => {
                assert_eq!(variants[0].wire_name, "payment_required");
                assert_eq!(variants[1].wire_name, "activation_required");
            }
            other => panic!("unexpected {other:?}"),
        }
        let maps = struct_named(&types, "McpViewMaps");
        assert_eq!(field(maps, "tool_for_view").wire_name, "TOOL_FOR_VIEW");
        let plan = struct_named(&types, "PaywallPlanSummary");
        assert_eq!(field(plan, "plan_type").wire_name, "type");
        let env = struct_named(&types, "ResponseEnvelope");
        assert_eq!(
            field(env, "solvapay_response").wire_name,
            "__solvapayResponse"
        );
    }

    #[test]
    fn extracts_unit_internally_tagged_untagged_and_data_variants() {
        let unit = r#"
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CustomerRefKind {
    Anonymous,
    Backend,
    NeedsEnsure,
}
"#;
        let tagged = r#"
#[derive(Serialize, Deserialize)]
#[serde(tag = "outcome", rename_all = "camelCase")]
pub enum PaywallOutcome {
    Allow,
    Gate {
        gate: PaywallGate,
    },
}
"#;
        let untagged = r#"
#[derive(Serialize, Deserialize)]
#[serde(untagged)]
pub enum ValidateBusinessDetailsResult {
    Success {
        success: bool,
        data: BusinessDetails,
    },
    Failure {
        success: bool,
        error: BusinessDetailsValidationError,
    },
}
"#;
        let sdk = r#"
#[derive(Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum SdkError {
    Api {
        message: String,
        status: Option<u16>,
        code: Option<String>,
    },
    Paywall {
        message: String,
        gate: PaywallGate,
    },
    #[cfg(feature = "webhook-verify")]
    Webhook {
        message: String,
        code: WebhookErrorCode,
    },
    Transport {
        message: String,
        retryable: bool,
    },
}
"#;
        let unit_ty = &scan_core_types(unit, "customer_sync").unwrap()[0];
        match &unit_ty.shape {
            IrCoreShape::UnitEnum { variants, .. } => {
                assert_eq!(variants[2].wire_name, "needsEnsure");
            }
            other => panic!("{other:?}"),
        }
        let tagged_ty = &scan_core_types(tagged, "paywall_decision").unwrap()[0];
        match &tagged_ty.shape {
            IrCoreShape::TaggedEnum { tag, variants, .. } => {
                assert_eq!(tag, "outcome");
                assert_eq!(variants[0].rust_name, "Allow");
                assert!(variants[0].fields.is_empty());
                assert_eq!(
                    variants[1].fields[0].ty,
                    IrCoreFieldTy::Named("PaywallGate".into())
                );
            }
            other => panic!("{other:?}"),
        }
        let untagged_ty = &scan_core_types(untagged, "business_details").unwrap()[0];
        match &untagged_ty.shape {
            IrCoreShape::UntaggedEnum { variants, .. } => {
                assert_eq!(variants.len(), 2);
                assert_eq!(
                    variants[0].fields[1].ty,
                    IrCoreFieldTy::Named("BusinessDetails".into())
                );
            }
            other => panic!("{other:?}"),
        }
        let sdk_ty = &scan_core_types(sdk, "error").unwrap()[0];
        match &sdk_ty.shape {
            IrCoreShape::TaggedEnum { tag, variants, .. } => {
                assert_eq!(tag, "kind");
                assert_eq!(variants[2].cfg_feature.as_deref(), Some("webhook-verify"));
                assert!(variants[0].fields[1].optional);
                assert_eq!(variants[0].fields[1].ty, IrCoreFieldTy::U16);
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn maps_field_types_and_serialize_with() {
        let src = r#"
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductReadinessInput {
    pub status: String,
    #[serde(default)]
    pub plans: Option<Vec<ProductReadinessPlan>>,
}

#[derive(Serialize, Deserialize)]
pub struct CachedLimitsEvaluation {
    pub within_limits: bool,
    #[serde(serialize_with = "serialize_whole_f64")]
    pub remaining: f64,
    pub evict: bool,
}

#[derive(Serialize, Deserialize)]
pub struct UsageSnapshot {
    #[serde(serialize_with = "serialize_opt_whole_f64")]
    pub total: Option<f64>,
    pub issues: Vec<String>,
    pub active_plans: u32,
}
"#;
        let types = scan_core_types(src, "mix").unwrap();
        let input = struct_named(&types, "ProductReadinessInput");
        let plans = field(input, "plans");
        assert!(plans.optional);
        assert!(plans.serde_default);
        assert_eq!(
            plans.ty,
            IrCoreFieldTy::Vec(Box::new(IrCoreFieldTy::Named(
                "ProductReadinessPlan".into()
            )))
        );
        let cached = struct_named(&types, "CachedLimitsEvaluation");
        assert_eq!(
            field(cached, "remaining").serialize_with.as_deref(),
            Some("serialize_whole_f64")
        );
        assert_eq!(field(cached, "remaining").ty, IrCoreFieldTy::F64);
        let usage = struct_named(&types, "UsageSnapshot");
        assert_eq!(
            field(usage, "total").serialize_with.as_deref(),
            Some("serialize_opt_whole_f64")
        );
        assert!(field(usage, "total").optional);
        assert_eq!(
            field(usage, "issues").ty,
            IrCoreFieldTy::Vec(Box::new(IrCoreFieldTy::String))
        );
        assert_eq!(field(usage, "active_plans").ty, IrCoreFieldTy::U32);
    }

    fn first_fn(src: &str) -> IrCoreFn {
        scan_core_file(src, "customer_sync", false)
            .unwrap()
            .fns
            .into_iter()
            .next()
            .expect("fn")
    }

    #[test]
    fn result_return_keeps_ok_and_err_named_types() {
        let func = first_fn(
            r#"
#[solvapay_export]
pub fn resolve_check_limits_params() -> Result<CheckLimitsParams, HelperErrorResult> {
    unimplemented!()
}
"#,
        );
        assert_eq!(
            func.return_ty.ty,
            IrCoreFieldTy::Result {
                ok: Box::new(IrCoreFieldTy::Named("CheckLimitsParams".into())),
                err: Box::new(IrCoreFieldTy::Named("HelperErrorResult".into())),
            }
        );
        assert_eq!(
            named_refs_in_field_ty(&func.return_ty.ty),
            vec![
                "CheckLimitsParams".to_string(),
                "HelperErrorResult".to_string()
            ]
        );
    }

    #[test]
    fn export_attr_detected() {
        let func = first_fn(
            r#"
#[solvapay_export]
pub fn classify_customer_ref(customer_ref: &str) -> CustomerRefKind {
    unimplemented!()
}
"#,
        );
        assert!(func.exported.is_some());
        assert!(!func.is_async);
    }

    #[test]
    fn bare_pub_fn_has_no_export_attr() {
        let func = first_fn(
            r#"
pub fn classify_customer_ref(customer_ref: &str) -> CustomerRefKind {
    unimplemented!()
}
"#,
        );
        assert!(func.exported.is_none());
    }

    #[test]
    fn export_attr_parses_key_value_args() {
        let func = first_fn(
            r#"
#[solvapay_export(
    artifact = "decisions",
    catalog = "none",
    section = "customer-sync",
    emit_order = 0,
    host_injected = "nowMs",
    typed_as = "state:PaywallState"
)]
pub fn classify_customer_ref(customer_ref: &str) -> CustomerRefKind {
    unimplemented!()
}
"#,
        );
        let exported = func.exported.expect("exported");
        assert_eq!(exported.artifact.as_deref(), Some("decisions"));
        assert_eq!(exported.catalog.as_deref(), Some("none"));
        assert_eq!(exported.section.as_deref(), Some("customer-sync"));
        assert_eq!(exported.emit_order, Some(0));
        assert_eq!(exported.host_injected, vec!["nowMs".to_owned()]);
        assert_eq!(
            exported.typed_as.get("state").map(String::as_str),
            Some("PaywallState")
        );
    }

    #[test]
    fn export_attr_parses_client_keys() {
        let func = first_fn(
            r#"
impl SolvaPayClient {
    #[solvapay_export(
        catalog = "operation",
        section = "Group C",
        emit_order = 22,
        dto_type = "CloneProductOverrides",
        split_path_refs = "productRef"
    )]
    pub async fn clone_product(&self, product_ref: &str, overrides: CloneProductOverrides) -> Result<CloneProductResult, SdkError> {
        unimplemented!()
    }
}
"#,
        );
        assert!(func.is_async);
        assert_eq!(func.impl_ty.as_deref(), Some("SolvaPayClient"));
        let exported = func.exported.expect("exported");
        assert_eq!(exported.dto_type.as_deref(), Some("CloneProductOverrides"));
        assert_eq!(exported.split_path_refs, vec!["productRef".to_owned()]);
        assert_eq!(exported.emit_order, Some(22));
    }

    #[test]
    fn transport_method_core_path_is_not_solvapay_core() {
        let mut func = first_fn(
            r#"
impl SolvaPayClient {
    pub async fn activate_plan(&self, params: ActivatePlanDto) -> Result<ActivatePlanResponseDto, SdkError> {
        unimplemented!()
    }
}
"#,
        );
        func.crate_name = "solvapay_transport".into();
        assert!(func.core_path().starts_with("solvapay_transport::"));
        assert!(!func.core_path().starts_with("solvapay_core::"));
        assert_eq!(
            func.binding_core(),
            "solvapay_transport::SolvaPayClient::activate_plan"
        );
    }

    #[test]
    fn export_attr_unknown_key_errors() {
        let err = scan_core_file(
            r#"
#[solvapay_export(mystery = "nope")]
pub fn classify_customer_ref(customer_ref: &str) -> CustomerRefKind {
    unimplemented!()
}
"#,
            "customer_sync",
            false,
        )
        .expect_err("unknown key");
        let msg = err.to_string();
        assert!(
            msg.contains("unknown key mystery"),
            "unexpected error: {msg}"
        );
    }
}
