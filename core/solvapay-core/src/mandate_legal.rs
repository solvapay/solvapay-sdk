//! Mandate legal-document selection.
//!
//! Decides which Terms / Privacy URLs a charge consent names. Sentence
//! grammar stays in the locale bundle; this module only chooses the
//! documents and their order.

use serde::{Deserialize, Serialize};

/// Hosted SolvaPay Terms of Service.
const SOLVAPAY_TERMS_URL: &str = "https://solvapay.com/legal/terms";
/// Hosted SolvaPay Privacy Policy.
const SOLVAPAY_PRIVACY_URL: &str = "https://solvapay.com/legal/privacy";
/// SolvaPay marketing site, used by the footer attribution link.
const SOLVAPAY_WEBSITE_URL: &str = "https://solvapay.com";

/// Which legal document a URL points at.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MandateLegalDocKind {
    /// Terms of Service.
    Terms,
    /// Privacy Policy.
    Privacy,
}

/// One legal document URL and the label kind a locale should use.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MandateLegalDoc {
    /// Absolute URL embedded in the mandate sentence.
    pub url: String,
    /// Document kind. The locale owns the visible label.
    pub kind: MandateLegalDocKind,
}

/// Documents a mandate should name.
///
/// `links` is merchant documents then SolvaPay documents, with duplicate
/// URLs removed. `merchant_docs` and `solvapay_docs` are not de-duplicated
/// against each other — the sentence names both parties even when they
/// share a URL.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MandateLegalDocs {
    /// `displayName`, or `legalName` when the display name is absent.
    pub merchant_brand: Option<String>,
    /// Merchant Terms then Privacy, each only when the URL is non-empty.
    pub merchant_docs: Vec<MandateLegalDoc>,
    /// SolvaPay Terms then Privacy. Always both.
    pub solvapay_docs: Vec<MandateLegalDoc>,
    /// Merchant docs then SolvaPay docs, first URL wins.
    pub links: Vec<MandateLegalDoc>,
}

/// Merchant legal fields. SolvaPay URLs are not inputs — core owns them.
#[derive(Debug, Clone, PartialEq, Eq, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct MandateLegalInput {
    /// Merchant Terms of Service URL.
    pub merchant_terms_url: Option<String>,
    /// Merchant Privacy Policy URL.
    pub merchant_privacy_url: Option<String>,
    /// Customer-facing merchant name.
    pub merchant_display_name: Option<String>,
    /// Registered merchant name. Brand fallback.
    pub merchant_legal_name: Option<String>,
}

/// Trim and drop empty strings.
fn nonempty(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_owned)
}

fn doc(url: String, kind: MandateLegalDocKind) -> MandateLegalDoc {
    MandateLegalDoc { url, kind }
}

fn push_unique(links: &mut Vec<MandateLegalDoc>, url: String, kind: MandateLegalDocKind) {
    if links.iter().any(|existing| existing.url == url) {
        return;
    }
    links.push(doc(url, kind));
}

/// Hosted SolvaPay Terms of Service URL.
#[must_use]
#[crate::solvapay_export(
    artifact = "payloadBuilders",
    catalog = "coreHelper",
    section = "mandate-legal",
    emit_order = 0
)]
pub fn solvapay_terms_url() -> &'static str {
    SOLVAPAY_TERMS_URL
}

/// Hosted SolvaPay Privacy Policy URL.
#[must_use]
#[crate::solvapay_export(
    artifact = "payloadBuilders",
    catalog = "coreHelper",
    section = "mandate-legal",
    emit_order = 1
)]
pub fn solvapay_privacy_url() -> &'static str {
    SOLVAPAY_PRIVACY_URL
}

/// SolvaPay website URL used by the footer attribution link.
#[must_use]
#[crate::solvapay_export(
    artifact = "payloadBuilders",
    catalog = "coreHelper",
    section = "mandate-legal",
    emit_order = 2
)]
pub fn solvapay_website_url() -> &'static str {
    SOLVAPAY_WEBSITE_URL
}

/// Choose the legal documents a mandate names.
///
/// Merchant documents are included only when their URL is non-empty.
/// SolvaPay's Terms and Privacy are always present. The brand is the
/// display name, falling back to the legal name. `links` follows
/// merchant-then-SolvaPay order and keeps the first copy of a URL.
///
/// # Arguments
///
/// * `input` - Merchant URLs and names. SolvaPay URLs are not parameters.
///
/// # Returns
///
/// Brand, merchant documents, SolvaPay documents, and de-duplicated links.
#[must_use]
#[crate::solvapay_export(
    artifact = "payloadBuilders",
    catalog = "coreHelper",
    section = "mandate-legal",
    emit_order = 3
)]
pub fn resolve_mandate_legal_docs(input: &MandateLegalInput) -> MandateLegalDocs {
    let terms = nonempty(input.merchant_terms_url.as_deref());
    let privacy = nonempty(input.merchant_privacy_url.as_deref());
    let merchant_brand = nonempty(input.merchant_display_name.as_deref())
        .or_else(|| nonempty(input.merchant_legal_name.as_deref()));

    let mut merchant_docs = Vec::new();
    if let Some(url) = terms.clone() {
        merchant_docs.push(doc(url, MandateLegalDocKind::Terms));
    }
    if let Some(url) = privacy.clone() {
        merchant_docs.push(doc(url, MandateLegalDocKind::Privacy));
    }

    let solvapay_docs = vec![
        doc(solvapay_terms_url().to_owned(), MandateLegalDocKind::Terms),
        doc(
            solvapay_privacy_url().to_owned(),
            MandateLegalDocKind::Privacy,
        ),
    ];

    let mut links = Vec::new();
    if let Some(url) = terms {
        push_unique(&mut links, url, MandateLegalDocKind::Terms);
    }
    if let Some(url) = privacy {
        push_unique(&mut links, url, MandateLegalDocKind::Privacy);
    }
    for entry in &solvapay_docs {
        push_unique(&mut links, entry.url.clone(), entry.kind);
    }

    MandateLegalDocs {
        merchant_brand,
        merchant_docs,
        solvapay_docs,
        links,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(
        terms: Option<&str>,
        privacy: Option<&str>,
        display: Option<&str>,
        legal: Option<&str>,
    ) -> MandateLegalInput {
        MandateLegalInput {
            merchant_terms_url: terms.map(str::to_owned),
            merchant_privacy_url: privacy.map(str::to_owned),
            merchant_display_name: display.map(str::to_owned),
            merchant_legal_name: legal.map(str::to_owned),
        }
    }

    #[test]
    fn constants_match_the_hosted_pages() {
        assert_eq!(solvapay_terms_url(), "https://solvapay.com/legal/terms");
        assert_eq!(solvapay_privacy_url(), "https://solvapay.com/legal/privacy");
        assert_eq!(solvapay_website_url(), "https://solvapay.com");
    }

    #[test]
    fn merchant_both_urls_precede_solvapay() {
        let docs = resolve_mandate_legal_docs(&input(
            Some("https://merchant.example/terms"),
            Some("https://merchant.example/privacy"),
            Some("Acme"),
            Some("Acme Inc"),
        ));
        assert_eq!(docs.merchant_brand.as_deref(), Some("Acme"));
        assert_eq!(docs.merchant_docs.len(), 2);
        assert_eq!(docs.solvapay_docs.len(), 2);
        assert_eq!(
            docs.links
                .iter()
                .map(|entry| entry.url.as_str())
                .collect::<Vec<_>>(),
            vec![
                "https://merchant.example/terms",
                "https://merchant.example/privacy",
                "https://solvapay.com/legal/terms",
                "https://solvapay.com/legal/privacy",
            ]
        );
    }

    #[test]
    fn merchant_terms_only_skips_an_empty_privacy_url() {
        let docs = resolve_mandate_legal_docs(&input(
            Some("https://merchant.example/terms"),
            Some("  "),
            Some("Acme"),
            None,
        ));
        assert_eq!(docs.merchant_docs.len(), 1);
        assert_eq!(docs.merchant_docs[0].kind, MandateLegalDocKind::Terms);
        assert_eq!(docs.links.len(), 3);
    }

    #[test]
    fn merchant_neither_url_still_names_solvapay() {
        let docs = resolve_mandate_legal_docs(&input(None, None, None, None));
        assert_eq!(docs.merchant_brand, None);
        assert!(docs.merchant_docs.is_empty());
        assert_eq!(docs.links.len(), 2);
        assert_eq!(docs.links[0].url, solvapay_terms_url());
        assert_eq!(docs.links[1].url, solvapay_privacy_url());
    }

    #[test]
    fn duplicate_solvapay_url_is_kept_once_in_links() {
        let docs = resolve_mandate_legal_docs(&input(
            Some(solvapay_terms_url()),
            Some("https://merchant.example/privacy"),
            Some("Acme"),
            None,
        ));
        assert_eq!(docs.solvapay_docs.len(), 2);
        assert_eq!(
            docs.links
                .iter()
                .map(|entry| entry.url.as_str())
                .collect::<Vec<_>>(),
            vec![
                "https://solvapay.com/legal/terms",
                "https://merchant.example/privacy",
                "https://solvapay.com/legal/privacy",
            ]
        );
        assert_eq!(docs.links[0].kind, MandateLegalDocKind::Terms);
    }

    #[test]
    fn brand_falls_back_to_legal_name() {
        let docs = resolve_mandate_legal_docs(&input(None, None, Some("  "), Some("Acme Legal")));
        assert_eq!(docs.merchant_brand.as_deref(), Some("Acme Legal"));
    }
}
