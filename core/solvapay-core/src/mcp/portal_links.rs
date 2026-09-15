//! Hosted-portal deep links minted from a customer session URL.
//!
//! Keep [`PORTAL_AUTO_RECHARGE_QUERY`] in lockstep with
//! `apps/customer-app/src/pages/customer/manage/index.tsx`.

/// Query that opens the auto-recharge form on the customer manage page.
pub const PORTAL_AUTO_RECHARGE_QUERY: &str = "tab=credits&intent=autorecharge";

/// Suffix a minted customer-portal URL so it opens the auto-recharge form.
///
/// Returns `None` for a missing or non-http URL — no silent default.
#[must_use]
pub fn auto_recharge_url_from(customer_url: Option<&str>) -> Option<String> {
    let url = customer_url?;
    let lower = url.to_ascii_lowercase();
    if !lower.starts_with("http://") && !lower.starts_with("https://") {
        return None;
    }
    let separator = if url.contains('?') { '&' } else { '?' };
    Some(format!("{url}{separator}{PORTAL_AUTO_RECHARGE_QUERY}"))
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::auto_recharge_url_from;

    #[test]
    fn rejects_missing_and_non_http() {
        assert_eq!(auto_recharge_url_from(None), None);
        assert_eq!(auto_recharge_url_from(Some("")), None);
        assert_eq!(auto_recharge_url_from(Some("ui://portal")), None);
        assert_eq!(auto_recharge_url_from(Some("ftp://portal.example/s")), None);
    }

    #[test]
    fn suffixes_http_urls() {
        assert_eq!(
            auto_recharge_url_from(Some("https://portal.example/s")).as_deref(),
            Some("https://portal.example/s?tab=credits&intent=autorecharge")
        );
        assert_eq!(
            auto_recharge_url_from(Some("https://portal.example/s?foo=1")).as_deref(),
            Some("https://portal.example/s?foo=1&tab=credits&intent=autorecharge")
        );
        assert_eq!(
            auto_recharge_url_from(Some("HTTP://portal.example/s")).as_deref(),
            Some("HTTP://portal.example/s?tab=credits&intent=autorecharge")
        );
    }
}
