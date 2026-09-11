//! HTML-entity decode and Guerrilla Mail `res.php` image-URL unwrap.

use crate::error::ExampleError;

/// Decode common HTML entities used in `mail_subject` / `mail_excerpt`.
///
/// # Errors
///
/// When a numeric character reference is out of range or unterminated.
pub fn decode_html_entities(input: &str) -> Result<String, ExampleError> {
    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    while let Some(amp) = rest.find('&') {
        out.push_str(&rest[..amp]);
        rest = &rest[amp..];
        let Some(semi) = rest.find(';') else {
            return Err(ExampleError::new(format!(
                "unterminated HTML entity in {input:?}"
            )));
        };
        let entity = &rest[..=semi];
        rest = &rest[semi + 1..];
        out.push_str(&decode_one(entity)?);
    }
    out.push_str(rest);
    Ok(out)
}

/// Decode a single `&…;` entity.
fn decode_one(entity: &str) -> Result<String, ExampleError> {
    match entity {
        "&amp;" => Ok("&".to_owned()),
        "&lt;" => Ok("<".to_owned()),
        "&gt;" => Ok(">".to_owned()),
        "&quot;" => Ok("\"".to_owned()),
        "&apos;" | "&#39;" | "&#039;" => Ok("'".to_owned()),
        "&laquo;" => Ok("«".to_owned()),
        "&raquo;" => Ok("»".to_owned()),
        other if other.starts_with("&#x") || other.starts_with("&#X") => {
            let hex = other
                .trim_start_matches("&#x")
                .trim_start_matches("&#X")
                .trim_end_matches(';');
            codepoint_to_string(u32::from_str_radix(hex, 16).map_err(|_| {
                ExampleError::new(format!("invalid hex character reference {other}"))
            })?)
        }
        other if other.starts_with("&#") => {
            let digits = other.trim_start_matches("&#").trim_end_matches(';');
            codepoint_to_string(digits.parse::<u32>().map_err(|_| {
                ExampleError::new(format!("invalid decimal character reference {other}"))
            })?)
        }
        other => Err(ExampleError::new(format!(
            "unsupported HTML entity {other}"
        ))),
    }
}

/// Turn a numeric character reference into a UTF-8 string.
fn codepoint_to_string(code: u32) -> Result<String, ExampleError> {
    char::from_u32(code)
        .map(|c| c.to_string())
        .ok_or_else(|| ExampleError::new(format!("invalid unicode code point {code}")))
}

/// Replace `/res.php?…&q=<urlencoded>` image URLs with the original `q` value.
///
/// # Errors
///
/// When a `res.php` URL is missing `q`, or `q` is not valid percent-encoding.
pub fn unwrap_res_php_urls(html: &str) -> Result<String, ExampleError> {
    let mut out = String::with_capacity(html.len());
    let mut rest = html;
    while let Some(idx) = find_res_php(rest) {
        out.push_str(&rest[..idx]);
        let after = &rest[idx..];
        let end = after
            .find(|c: char| c == '"' || c == '\'' || c.is_whitespace() || c == '>')
            .unwrap_or(after.len());
        let url = &after[..end];
        let original = extract_q(url)?;
        out.push_str(&original);
        rest = &after[end..];
    }
    out.push_str(rest);
    Ok(out)
}

/// Byte offset of the next `res.php?` URL, preferring a leading `/`.
fn find_res_php(input: &str) -> Option<usize> {
    input
        .find("/res.php?")
        .or_else(|| input.find("res.php?"))
        .map(|idx| {
            if input[idx..].starts_with("/res.php?") {
                idx
            } else if idx > 0 && input.as_bytes().get(idx - 1) == Some(&b'/') {
                idx - 1
            } else {
                idx
            }
        })
}

/// Percent-decode the `q` query parameter from a `res.php` URL.
fn extract_q(url: &str) -> Result<String, ExampleError> {
    let marker = "q=";
    let Some(q_at) = url.find(marker) else {
        return Err(ExampleError::new(format!(
            "res.php URL missing q parameter: {url}"
        )));
    };
    let encoded = &url[q_at + marker.len()..];
    let encoded = encoded.split('&').next().unwrap_or(encoded);
    percent_decode(encoded)
}

/// Decode `application/x-www-form-urlencoded` bytes as UTF-8.
fn percent_decode(input: &str) -> Result<String, ExampleError> {
    let mut bytes = Vec::with_capacity(input.len());
    let chars: Vec<char> = input.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        match chars[i] {
            '+' => {
                bytes.push(b' ');
                i += 1;
            }
            '%' => {
                if i + 2 >= chars.len() {
                    return Err(ExampleError::new(format!(
                        "truncated percent-encoding in {input:?}"
                    )));
                }
                let hex: String = chars[i + 1..=i + 2].iter().collect();
                let byte = u8::from_str_radix(&hex, 16).map_err(|_| {
                    ExampleError::new(format!("invalid percent-encoding %{hex} in {input:?}"))
                })?;
                bytes.push(byte);
                i += 3;
            }
            ch => {
                let mut buf = [0u8; 4];
                bytes.extend_from_slice(ch.encode_utf8(&mut buf).as_bytes());
                i += 1;
            }
        }
    }
    String::from_utf8(bytes)
        .map_err(|_| ExampleError::new(format!("percent-decoded q is not UTF-8: {input:?}")))
}

#[cfg(test)]
#[allow(
    missing_docs,
    clippy::missing_docs_in_private_items,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic
)]
mod tests {
    use super::*;

    #[test]
    fn decodes_subject_and_excerpt_entities() {
        assert_eq!(
            decode_html_entities("Hello &amp; Welcome").unwrap(),
            "Hello & Welcome"
        );
        assert_eq!(
            decode_html_entities("fighter&#039;s ally").unwrap(),
            "fighter's ally"
        );
    }

    #[test]
    fn unwraps_res_php_image_to_original_url() {
        let html = r#"<img src="/res.php?r=1&n=img&q=https%3A%2F%2Fcdn.example.com%2Flogo.png">"#;
        assert_eq!(
            unwrap_res_php_urls(html).unwrap(),
            r#"<img src="https://cdn.example.com/logo.png">"#
        );
    }
}
