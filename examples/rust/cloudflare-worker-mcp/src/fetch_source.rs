//! Guerrilla Mail [`Source`] over `worker::Fetch`.

use solvapay_example_guerrillamail_mcp::error::ExampleError;
use solvapay_example_guerrillamail_mcp::sources::{
    with_required_params, Source, SourceFuture, SourceRequest, SourceResponse,
};
use worker::Fetch;

/// Live Guerrilla Mail ajax client using the Workers Fetch API.
pub struct FetchSource {
    /// Ajax endpoint (`https://api.guerrillamail.com/ajax.php`).
    base_url: String,
}

impl FetchSource {
    /// Talk to the given ajax URL.
    #[must_use]
    pub fn new(base_url: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into(),
        }
    }
}

impl Source for FetchSource {
    fn call(&self, request: SourceRequest) -> SourceFuture<'_, Result<SourceResponse, ExampleError>> {
        Box::pin(async move {
            let recorded = with_required_params(request.clone());
            let mut pairs = recorded.params;
            if let Some(sid) = &request.sid_token {
                if !pairs.iter().any(|(k, _)| k == "sid_token") {
                    pairs.push(("sid_token".to_owned(), sid.clone()));
                }
            }
            let mut url = self.base_url.clone();
            for (index, (key, value)) in pairs.iter().enumerate() {
                url.push(if index == 0 && !self.base_url.contains('?') {
                    '?'
                } else {
                    '&'
                });
                url.push_str(&encode_query_component(key));
                url.push('=');
                url.push_str(&encode_query_component(value));
            }
            let parsed: url::Url = url.parse().map_err(|err| {
                ExampleError::new(format!("Guerrilla Mail URL is invalid: {err}"))
            })?;
            let mut response = Fetch::Url(parsed).send().await.map_err(|err| {
                ExampleError::new(format!(
                    "Guerrilla Mail {} request failed: {err}",
                    request.function
                ))
            })?;
            let status = response.status_code();
            let text = response.text().await.map_err(|err| {
                ExampleError::new(format!(
                    "Guerrilla Mail {} read failed: {err}",
                    request.function
                ))
            })?;
            if !(200..300).contains(&status) {
                return Err(ExampleError::new(format!(
                    "Guerrilla Mail {} returned HTTP {status}: {text}",
                    request.function
                )));
            }
            let body = serde_json::from_str(&text).map_err(|_| {
                ExampleError::new(format!(
                    "Guerrilla Mail {} returned non-JSON body: {text}",
                    request.function
                ))
            })?;
            Ok(SourceResponse { body })
        })
    }
}

fn encode_query_component(value: &str) -> String {
    let mut out = String::new();
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(char::from(byte));
            }
            b' ' => out.push('+'),
            _ => {
                out.push('%');
                out.push(char::from(hex_digit(byte >> 4)));
                out.push(char::from(hex_digit(byte & 0x0f)));
            }
        }
    }
    out
}

fn hex_digit(nibble: u8) -> u8 {
    if nibble < 10 {
        b'0' + nibble
    } else {
        b'A' + (nibble - 10)
    }
}
