//! Shared iteration over catalogued helper bindings for portable forwarders.

use crate::ir::{Ir, IrBindingCatalogLink, IrBindingSymbol, IrEntryPoint, IrRubyReceiver};

/// Catalogued top-level / core-helper bindings in stable id order.
pub(crate) fn catalog_helper_bindings(ir: &Ir) -> Vec<(&IrBindingSymbol, &IrEntryPoint)> {
    let mut rows: Vec<(&IrBindingSymbol, &IrEntryPoint)> = ir
        .binding_symbols
        .values()
        .filter_map(|binding| {
            let id = match &binding.catalog {
                IrBindingCatalogLink::TopLevel(id) | IrBindingCatalogLink::CoreHelper(id) => id,
                _ => return None,
            };
            ir.entry_points.get(id).map(|entry| (binding, entry))
        })
        .collect();
    rows.sort_by(|left, right| left.0.id.cmp(&right.0.id));
    rows
}

/// True when the catalog name is a screaming-snake constant.
pub(crate) fn is_constant_entry(entry: &IrEntryPoint) -> bool {
    entry.ruby_target.receiver == IrRubyReceiver::Constant
        || entry
            .names
            .py
            .chars()
            .all(|c| c.is_ascii_uppercase() || c == '_')
}

/// Snake-case a camelCase binding arg name.
pub(crate) fn snake(name: &str) -> String {
    let mut out = String::new();
    for (i, c) in name.chars().enumerate() {
        if c.is_uppercase() {
            if i > 0 {
                out.push('_');
            }
            out.extend(c.to_lowercase());
        } else {
            out.push(c);
        }
    }
    out
}
