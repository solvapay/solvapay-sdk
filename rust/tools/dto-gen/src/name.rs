//! Deterministic name helpers for Rust identifiers.

/// Rust keywords that cannot be used as bare identifiers.
const KEYWORDS: &[&str] = &[
    "as", "async", "await", "break", "const", "continue", "crate", "dyn", "else", "enum", "extern",
    "false", "fn", "for", "if", "impl", "in", "let", "loop", "match", "mod", "move", "mut", "pub",
    "ref", "return", "self", "Self", "static", "struct", "super", "trait", "true", "type",
    "unsafe", "use", "where", "while", "abstract", "become", "box", "do", "final", "macro",
    "override", "priv", "typeof", "unsized", "virtual", "yield", "try", "gen",
];

/// Returns true when `ident` is a Rust keyword.
pub fn is_keyword(ident: &str) -> bool {
    KEYWORDS.contains(&ident)
}

/// Converts `camelCase` / `PascalCase` / `snake_case` wire names to `snake_case`.
pub fn to_snake_case(input: &str) -> String {
    let mut out = String::with_capacity(input.len() + 4);
    let chars: Vec<char> = input.chars().collect();
    for (i, ch) in chars.iter().copied().enumerate() {
        if ch == '-' || ch == ' ' || ch == '.' || ch == '/' || ch == ':' {
            if !out.ends_with('_') {
                out.push('_');
            }
            continue;
        }
        if ch == '_' {
            if !out.ends_with('_') {
                out.push('_');
            }
            continue;
        }
        if ch.is_ascii_uppercase() {
            let prev_lower_or_digit =
                i > 0 && (chars[i - 1].is_ascii_lowercase() || chars[i - 1].is_ascii_digit());
            let next_lower = chars.get(i + 1).is_some_and(|c| c.is_ascii_lowercase());
            if !out.is_empty() && (prev_lower_or_digit || next_lower) && !out.ends_with('_') {
                out.push('_');
            }
            out.push(ch.to_ascii_lowercase());
        } else {
            out.push(ch);
        }
    }
    while out.contains("__") {
        out = out.replace("__", "_");
    }
    out.trim_matches('_').to_string()
}

/// Converts an arbitrary wire label to a safe snake_case Rust field/ident.
pub fn rust_field_name(wire: &str) -> String {
    let mut snake = to_snake_case(wire);
    if snake.is_empty() {
        snake = "value".to_string();
    }
    if snake.chars().next().is_some_and(|c| c.is_ascii_digit()) {
        snake = format!("n_{snake}");
    }
    if is_keyword(&snake) {
        format!("{snake}_")
    } else {
        snake
    }
}

/// Converts an arbitrary wire label to a safe PascalCase Rust type/variant name.
pub fn rust_type_name(wire: &str) -> String {
    let snake = to_snake_case(wire);
    let mut out = String::new();
    for part in snake.split('_') {
        if part.is_empty() {
            continue;
        }
        let mut chars = part.chars();
        if let Some(first) = chars.next() {
            out.push(first.to_ascii_uppercase());
            out.extend(chars);
        }
    }
    if out.is_empty() {
        return "Generated".to_string();
    }
    if out.chars().next().is_some_and(|c| c.is_ascii_digit()) {
        out = format!("N{out}");
    }
    if is_keyword(&out.to_ascii_lowercase()) {
        format!("{out}_")
    } else {
        out
    }
}

/// Joins parent type + field into a synthetic nested type name.
pub fn nested_type_name(parent: &str, field: &str) -> String {
    format!("{}{}", parent, rust_type_name(field))
}

/// Joins parent type + field + `Item` for array element object schemas.
pub fn nested_item_type_name(parent: &str, field: &str) -> String {
    format!("{}Item", nested_type_name(parent, field))
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::missing_docs_in_private_items
)]
mod tests {
    use super::*;

    #[test]
    fn snake_case_from_camel() {
        assert_eq!(to_snake_case("customerRef"), "customer_ref");
        assert_eq!(
            to_snake_case("includeCheckoutSession"),
            "include_checkout_session"
        );
        assert_eq!(to_snake_case("HTTPResponse"), "http_response");
    }

    #[test]
    fn keyword_field_gets_underscore() {
        assert_eq!(rust_field_name("type"), "type_");
        assert_eq!(rust_field_name("ref"), "ref_");
    }

    #[test]
    fn type_name_pascal() {
        assert_eq!(rust_type_name("customer_ref"), "CustomerRef");
        assert_eq!(rust_type_name("one-time"), "OneTime");
    }
}
