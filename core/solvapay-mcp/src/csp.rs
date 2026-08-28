//! Stripe baseline plus integrator overrides.

use serde::{Deserialize, Serialize};

/// Stripe baseline CSP allow-lists.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SolvaPayMcpCsp {
    /// `img-src` / font origins.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub resource_domains: Vec<String>,
    /// `connect-src` origins.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub connect_domains: Vec<String>,
    /// `frame-src` origins.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub frame_domains: Vec<String>,
}

fn default_csp() -> SolvaPayMcpCsp {
    SolvaPayMcpCsp {
        resource_domains: vec![
            "https://js.stripe.com".to_owned(),
            "https://*.stripe.com".to_owned(),
            "https://b.stripecdn.com".to_owned(),
        ],
        connect_domains: vec![
            "https://api.stripe.com".to_owned(),
            "https://m.stripe.com".to_owned(),
            "https://r.stripe.com".to_owned(),
            "https://q.stripe.com".to_owned(),
            "https://errors.stripe.com".to_owned(),
        ],
        frame_domains: vec![
            "https://js.stripe.com".to_owned(),
            "https://hooks.stripe.com".to_owned(),
        ],
    }
}

fn parse_origin(url: Option<&str>) -> Option<String> {
    let raw = url.filter(|s| !s.is_empty())?;
    let (scheme, rest) = raw.split_once("://")?;
    if scheme != "http" && scheme != "https" {
        return None;
    }
    let hostport = rest
        .split(['/', '?', '#'])
        .next()
        .filter(|s| !s.is_empty())?;
    Some(format!("{scheme}://{hostport}"))
}

fn merge_list(base: &[String], extras: &[Vec<String>]) -> Vec<String> {
    let mut out = Vec::new();
    for item in base.iter().chain(extras.iter().flatten()) {
        if !out.iter().any(|existing| existing == item) {
            out.push(item.clone());
        }
    }
    out
}

/// Merge integrator CSP overrides with the Stripe baseline and optional API origin.
#[must_use]
pub fn mcp_merge_csp(
    overrides: Option<&SolvaPayMcpCsp>,
    api_base_url: Option<&str>,
) -> SolvaPayMcpCsp {
    let base = default_csp();
    let api_origin = parse_origin(api_base_url);
    let extra_origin = api_origin
        .as_ref()
        .map(|o| vec![o.clone()])
        .unwrap_or_default();
    let ov = overrides.cloned().unwrap_or_default();
    SolvaPayMcpCsp {
        resource_domains: merge_list(
            &base.resource_domains,
            &[ov.resource_domains, extra_origin.clone()],
        ),
        connect_domains: merge_list(&base.connect_domains, &[ov.connect_domains, extra_origin]),
        frame_domains: merge_list(&base.frame_domains, &[ov.frame_domains]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_omits_data_scheme() {
        let csp = mcp_merge_csp(None, None);
        assert!(!csp.connect_domains.iter().any(|d| d == "data:"));
        assert!(!csp.resource_domains.iter().any(|d| d == "data:"));
    }
}
