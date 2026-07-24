//! HTTP request/response types for [`crate::Transport`].
//!
//! These are transport-layer shapes only: non-OK status codes are still
//! successful transports and surface as [`HttpResponse`], not [`SdkError`].

use solvapay_core::SdkError;

/// HTTP methods accepted by the SolvaPay transport (mirrors fixture wire verbs).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Method {
    /// `GET`
    Get,
    /// `POST`
    Post,
    /// `PUT`
    Put,
    /// `PATCH`
    Patch,
    /// `DELETE`
    Delete,
}

impl Method {
    /// Returns the uppercase HTTP verb string for this method.
    ///
    /// # Returns
    ///
    /// One of `GET`, `POST`, `PUT`, `PATCH`, or `DELETE`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Get => "GET",
            Self::Post => "POST",
            Self::Put => "PUT",
            Self::Patch => "PATCH",
            Self::Delete => "DELETE",
        }
    }

    /// Parses an uppercase HTTP verb into a [`Method`].
    ///
    /// # Arguments
    ///
    /// * `raw` - Uppercase verb (`GET`, `POST`, `PUT`, `PATCH`, or `DELETE`).
    ///
    /// # Returns
    ///
    /// The matching variant, or [`SdkError::Transport`] with `retryable: false`
    /// when `raw` is not one of the five allowed verbs.
    pub fn parse(raw: &str) -> Result<Self, SdkError> {
        match raw {
            "GET" => Ok(Self::Get),
            "POST" => Ok(Self::Post),
            "PUT" => Ok(Self::Put),
            "PATCH" => Ok(Self::Patch),
            "DELETE" => Ok(Self::Delete),
            other => Err(SdkError::transport(
                format!("unsupported HTTP method: {other}"),
                false,
            )),
        }
    }
}

/// Validated lowercase HTTP header name (RFC 7230 token), without depending on
/// the `http` crate.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct HeaderName(String);

impl HeaderName {
    /// Validates `raw` as an HTTP header-name token and stores it lowercased.
    ///
    /// # Arguments
    ///
    /// * `raw` - Header name (case-insensitive; stored as ASCII lowercase).
    ///
    /// # Returns
    ///
    /// A [`HeaderName`], or [`SdkError::Transport`] with `retryable: false` when
    /// the name is empty or contains characters outside the token alphabet.
    pub fn new(raw: &str) -> Result<Self, SdkError> {
        if raw.is_empty() {
            return Err(SdkError::transport(
                "header name must not be empty".to_owned(),
                false,
            ));
        }
        let lower = raw.to_ascii_lowercase();
        if !lower.bytes().all(is_header_token_byte) {
            return Err(SdkError::transport(
                format!("invalid header name: {raw}"),
                false,
            ));
        }
        Ok(Self(lower))
    }

    /// Returns the lowercase header name.
    ///
    /// # Returns
    ///
    /// The validated lowercase token string.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Returns whether `b` is allowed in an HTTP header-name token (RFC 7230).
///
/// # Arguments
///
/// * `b` - Byte to test.
///
/// # Returns
///
/// `true` when `b` is alphanumeric or one of `!#$%&'*+-.^_`|~`.
fn is_header_token_byte(b: u8) -> bool {
    matches!(
        b,
        b'!'
            | b'#'
            | b'$'
            | b'%'
            | b'&'
            | b'\''
            | b'*'
            | b'+'
            | b'-'
            | b'.'
            | b'^'
            | b'_'
            | b'`'
            | b'|'
            | b'~'
            | b'0'..=b'9'
            | b'a'..=b'z'
            | b'A'..=b'Z'
    )
}

/// Outbound HTTP request passed to [`crate::Transport::send`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HttpRequest {
    /// HTTP method.
    pub method: Method,
    /// Absolute URL including scheme, host, path, and query.
    pub url: String,
    /// Request headers (Authorization, Idempotency-Key, Content-Type, …).
    pub headers: Vec<(HeaderName, String)>,
    /// Optional raw body bytes (typically UTF-8 JSON).
    pub body: Option<Vec<u8>>,
}

/// Inbound HTTP response returned by [`crate::Transport::send`].
///
/// Any status code — including 4xx/5xx — is a successful transport result.
/// Mapping status codes to [`SdkError::Api`] is the client shell's job (step 21).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HttpResponse {
    /// HTTP status code.
    pub status: u16,
    /// Raw response body bytes.
    pub body: Vec<u8>,
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
    fn method_round_trips_as_str_and_parse() {
        for method in [
            Method::Get,
            Method::Post,
            Method::Put,
            Method::Patch,
            Method::Delete,
        ] {
            assert_eq!(Method::parse(method.as_str()).unwrap(), method);
        }
    }

    #[test]
    fn method_parse_rejects_unknown() {
        let err = Method::parse("HEAD").unwrap_err();
        match err {
            SdkError::Transport { retryable, .. } => assert!(!retryable),
            other => panic!("expected Transport, got {other:?}"),
        }
    }

    #[test]
    fn header_name_lowercases_and_validates() {
        let name = HeaderName::new("Content-Type").unwrap();
        assert_eq!(name.as_str(), "content-type");

        assert!(HeaderName::new("").is_err());
        assert!(HeaderName::new("bad name").is_err());
        assert!(HeaderName::new("x-custom_1").is_ok());
    }

    #[test]
    fn http_request_construction() {
        let req = HttpRequest {
            method: Method::Post,
            url: "https://api.example/v1".to_owned(),
            headers: vec![(
                HeaderName::new("Authorization").unwrap(),
                "Bearer sk_test".to_owned(),
            )],
            body: Some(br#"{"a":1}"#.to_vec()),
        };
        assert_eq!(req.method, Method::Post);
        assert_eq!(req.headers.len(), 1);
        assert_eq!(req.body.as_deref(), Some(br#"{"a":1}"#.as_slice()));
    }
}
