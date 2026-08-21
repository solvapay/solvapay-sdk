//! Pure checkout helper decision/normalization cores (Step 27).

use crate::helper_error::HelperErrorResult;

/// Frozen 400 message when productRef is missing or empty.
const PRODUCT_REF_REQUIRED: &str = "Missing required parameter: productRef is required";

/// JS-truthiness for string refs: [`None`] and `""` fail.
fn is_nonempty(value: Option<&str>) -> bool {
    value.is_some_and(|s| !s.is_empty())
}

/// Validate checkout-session body productRef (JS truthiness: empty string fails).
///
/// # Arguments
///
/// * `product_ref` - Product reference; empty/`None` fails.
///
/// # Returns
///
/// [`None`] when productRef is present and non-empty; otherwise the frozen 400.
pub fn validate_checkout_session_params(product_ref: Option<&str>) -> Option<HelperErrorResult> {
    if is_nonempty(product_ref) {
        None
    } else {
        Some(HelperErrorResult::without_details(
            PRODUCT_REF_REQUIRED,
            400,
        ))
    }
}

/// Resolve returnUrl with JS-falsy precedence: body → options → origin → none.
///
/// Empty strings are falsy and fall through. `origin` is the already-parsed
/// request origin (or [`None`] when URL parsing failed).
///
/// # Arguments
///
/// * `body_return_url` - `body.returnUrl`.
/// * `options_return_url` - `options.returnUrl`.
/// * `origin` - Parsed request origin.
///
/// # Returns
///
/// The first non-empty candidate, or [`None`].
pub fn resolve_return_url(
    body_return_url: Option<&str>,
    options_return_url: Option<&str>,
    origin: Option<&str>,
) -> Option<String> {
    if is_nonempty(body_return_url) {
        return body_return_url.map(str::to_owned);
    }
    if is_nonempty(options_return_url) {
        return options_return_url.map(str::to_owned);
    }
    if is_nonempty(origin) {
        return origin.map(str::to_owned);
    }
    None
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

    #[test]
    fn product_present_ok() {
        assert!(validate_checkout_session_params(Some("prd_1")).is_none());
    }

    #[test]
    fn product_empty_fails() {
        let err = validate_checkout_session_params(Some("")).unwrap();
        assert_eq!(err.error, PRODUCT_REF_REQUIRED);
        assert_eq!(err.status, 400);
    }

    #[test]
    fn return_url_body_wins() {
        assert_eq!(
            resolve_return_url(
                Some("https://body.example/return"),
                Some("https://options.example/return"),
                Some("https://origin"),
            )
            .as_deref(),
            Some("https://body.example/return")
        );
    }

    #[test]
    fn return_url_empty_falls_to_origin() {
        assert_eq!(
            resolve_return_url(Some(""), Some(""), Some("https://origin")).as_deref(),
            Some("https://origin")
        );
    }

    #[test]
    fn return_url_all_absent() {
        assert!(resolve_return_url(None, None, None).is_none());
    }
}
