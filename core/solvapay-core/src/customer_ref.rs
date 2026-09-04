//! Single customer-ref precedence for every HTTP and MCP facade.

/// Frozen no-identity ref. Never fabricate `demo_user`.
pub const ANONYMOUS_CUSTOMER_REF: &str = "anonymous";

/// Return the first non-empty trimmed candidate, if any.
fn first_nonempty(candidates: &[Option<&str>]) -> Option<String> {
    for candidate in candidates {
        if let Some(value) = candidate.map(str::trim).filter(|s| !s.is_empty()) {
            return Some(value.to_owned());
        }
    }
    None
}

/// Resolve a customer ref from optional identity sources.
///
/// Precedence: hook → verified JWT `sub` → `x-user-id` → `x-customer-ref`
/// → MCP extra → `args.auth.customer_ref` → `args.customer_ref` → `anonymous`.
///
/// Facades verify tokens and pass the resulting `sub`; this op does not
/// read headers or environment.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "none",
    section = "customer",
    emit_order = 31
)]
pub fn resolve_customer_ref(
    hook_ref: Option<&str>,
    verified_jwt_sub: Option<&str>,
    header_user_id: Option<&str>,
    header_customer_ref: Option<&str>,
    mcp_extra_customer_ref: Option<&str>,
    args_auth_customer_ref: Option<&str>,
    args_customer_ref: Option<&str>,
) -> String {
    first_nonempty(&[
        hook_ref,
        verified_jwt_sub,
        header_user_id,
        header_customer_ref,
        mcp_extra_customer_ref,
        args_auth_customer_ref,
        args_customer_ref,
    ])
    .unwrap_or_else(|| ANONYMOUS_CUSTOMER_REF.to_owned())
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn hook_wins() {
        assert_eq!(
            resolve_customer_ref(
                Some("hook"),
                Some("jwt"),
                Some("user"),
                Some("header"),
                Some("extra"),
                Some("auth"),
                Some("args"),
            ),
            "hook"
        );
    }

    #[test]
    fn jwt_beats_header() {
        assert_eq!(
            resolve_customer_ref(
                None,
                Some("jwt-sub"),
                None,
                Some("header-ref"),
                None,
                None,
                None,
            ),
            "jwt-sub"
        );
    }

    #[test]
    fn empty_and_whitespace_fall_through() {
        assert_eq!(
            resolve_customer_ref(Some("  "), None, None, None, None, None, Some("args_ref")),
            "args_ref"
        );
    }

    #[test]
    fn anonymous_when_nothing_present() {
        assert_eq!(
            resolve_customer_ref(None, None, None, None, None, None, None),
            ANONYMOUS_CUSTOMER_REF
        );
    }
}
