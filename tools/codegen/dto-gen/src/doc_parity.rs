//! Cross-language emitted-summary parity (Phase 3).
//!
//! [`check_doc_coverage`](crate::check_doc_coverage) proves the IR has a
//! summary. This module proves every language whose emission is `Generated`
//! actually rendered that summary into source.

use std::collections::BTreeSet;
use std::path::Path;

use serde::Deserialize;

use crate::error::{GenError, GenResult};
use crate::ir::{Ir, IrEmissionMode, IrEntryPoint, IrEntrySection};

/// Languages whose generated docs are compared against the contract summary.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum DocLang {
    /// TypeScript TSDoc.
    Ts,
    /// Python docstring.
    Py,
    /// Ruby YARD.
    Rb,
    /// Go godoc.
    Go,
    /// Rust rustdoc.
    Rust,
    /// C (only checked when a surface is supplied).
    C,
}

impl DocLang {
    /// Stable lowercase id used in failure keys and the pending file.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ts => "ts",
            Self::Py => "py",
            Self::Rb => "rb",
            Self::Go => "go",
            Self::Rust => "rust",
            Self::C => "c",
        }
    }

    /// Parse a pending-file language column.
    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "ts" => Some(Self::Ts),
            "py" => Some(Self::Py),
            "rb" => Some(Self::Rb),
            "go" => Some(Self::Go),
            "rust" => Some(Self::Rust),
            "c" => Some(Self::C),
            _ => None,
        }
    }
}

/// One generated (or empty placeholder) source blob for a language.
pub struct EmittedSurface {
    /// Language column.
    pub lang: DocLang,
    /// Human label for diagnostics (file or emitter name).
    pub label: &'static str,
    /// Concatenated source text to search.
    pub source: String,
}

/// One shrinking allowlist row in `doc-parity-pending.yaml`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct PendingEntry {
    /// Catalog id (`deriveTaxIdType`, `mcpNarrate`, …).
    pub id: String,
    /// Language column (`ts`, `py`, `rb`, `go`, `rust`).
    pub lang: String,
    /// Plan step that must delete this row.
    pub step: String,
}

/// Strips comment markers, collapses whitespace, lowercases.
///
/// Godoc's `Name summary…` prefix and its leading-lowercase idiom both survive:
/// the identifier sits *before* the summary, so the normalized summary is still
/// a substring of the normalized comment.
pub fn normalize_doc_text(raw: &str) -> String {
    let mut pieces = Vec::new();
    for line in raw.lines() {
        let stripped = strip_comment_markers(line);
        if !stripped.is_empty() {
            pieces.push(stripped);
        }
    }
    pieces
        .join(" ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn strip_comment_markers(line: &str) -> String {
    let mut t = line.trim();
    t = t.trim_start_matches("/**").trim_end_matches("*/").trim();
    t = t.trim_start_matches("/*").trim();
    if let Some(rest) = t.strip_prefix('*') {
        t = rest.trim_start();
    }
    if let Some(rest) = t.strip_prefix("///") {
        t = rest.trim_start();
    } else if let Some(rest) = t.strip_prefix("//") {
        t = rest.trim_start();
    }
    if let Some(rest) = t.strip_prefix('#') {
        t = rest.trim_start();
    }
    t.to_string()
}

/// Loads the shrinking pending list. An absent file is an empty list.
///
/// # Errors
///
/// Returns [`GenError::Parse`] when the YAML is invalid, empty-but-present, or
/// a row is missing `id` / `lang` / `step`.
pub fn load_pending(path: &Path) -> GenResult<Vec<PendingEntry>> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = std::fs::read_to_string(path).map_err(|source| GenError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    if raw.trim().is_empty() {
        return Err(GenError::Parse(format!(
            "{} is empty; delete the file or restore entries with a step:",
            path.display()
        )));
    }
    let entries: Vec<PendingEntry> = serde_norway::from_str(&raw)
        .map_err(|e| GenError::Parse(format!("invalid pending YAML: {e}")))?;
    if entries.is_empty() {
        return Err(GenError::Parse(format!(
            "{} has no entries; delete the file rather than leaving an empty list",
            path.display()
        )));
    }
    for entry in &entries {
        if entry.id.trim().is_empty()
            || entry.lang.trim().is_empty()
            || entry.step.trim().is_empty()
        {
            return Err(GenError::Parse(
                "doc-parity-pending.yaml entries require non-empty id, lang, and step".into(),
            ));
        }
        if DocLang::parse(&entry.lang).is_none() {
            return Err(GenError::Parse(format!(
                "doc-parity-pending.yaml unknown lang {}",
                entry.lang
            )));
        }
    }
    Ok(entries)
}

/// Asserts every generated catalog entry's summary appears in that language's
/// concatenated sources. `pending` keys are `(id, lang)` and are subtracted
/// from the failure set.
///
/// # Errors
///
/// Returns [`GenError::DocParity`] listing remaining failures.
pub fn check_doc_parity(
    ir: &Ir,
    surfaces: &[EmittedSurface],
    pending: &BTreeSet<(String, String)>,
) -> GenResult<()> {
    let missing = collect_failures(ir, surfaces)
        .into_iter()
        .filter(|failure| {
            !pending.contains(&(failure.id.clone(), failure.lang.as_str().to_string()))
        })
        .map(|failure| failure.key)
        .collect::<Vec<_>>();
    if missing.is_empty() {
        return Ok(());
    }
    Err(GenError::DocParity { missing })
}

/// Failures that *would* fire if the pending list were empty.
pub fn collect_failures(ir: &Ir, surfaces: &[EmittedSurface]) -> Vec<ParityFailure> {
    let langs_present: BTreeSet<DocLang> = surfaces.iter().map(|s| s.lang).collect();
    let mut normalized: Vec<(DocLang, String)> = Vec::new();
    for lang in &langs_present {
        let concat = surfaces
            .iter()
            .filter(|s| s.lang == *lang)
            .map(|s| s.source.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        normalized.push((*lang, normalize_doc_text(&concat)));
    }

    let mut failures = Vec::new();
    for entry in ir.entry_points.values() {
        if !matches!(
            entry.section,
            IrEntrySection::TopLevel | IrEntrySection::CoreHelper | IrEntrySection::Mcp
        ) {
            continue;
        }
        let summary = normalize_doc_text(&entry.docs.summary);
        if summary.is_empty() {
            continue;
        }
        for lang in &langs_present {
            if !emission_for(entry, *lang).is_generated() {
                continue;
            }
            let Some((_, haystack)) = normalized.iter().find(|(l, _)| l == lang) else {
                continue;
            };
            if haystack.contains(&summary) {
                continue;
            }
            failures.push(ParityFailure {
                id: entry.id.clone(),
                lang: *lang,
                key: parity_key(entry, *lang),
            });
        }
    }
    failures.sort_by(|a, b| a.key.cmp(&b.key));
    failures
}

/// One missing rendered summary.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParityFailure {
    /// Catalog id.
    pub id: String,
    /// Language column.
    pub lang: DocLang,
    /// Stable diagnostic key.
    pub key: String,
}

fn parity_key(entry: &IrEntryPoint, lang: DocLang) -> String {
    match entry.section {
        IrEntrySection::Mcp => format!("mcp.{}.{}", entry.id, lang.as_str()),
        _ => format!("{}.{}", entry.id, lang.as_str()),
    }
}

fn emission_for(entry: &IrEntryPoint, lang: DocLang) -> &IrEmissionMode {
    match lang {
        DocLang::Ts => &entry.emission.ts,
        DocLang::Py => &entry.emission.py,
        DocLang::Rb => &entry.emission.rb,
        DocLang::Go => &entry.emission.go,
        DocLang::Rust => &entry.emission.rust,
        DocLang::C => &entry.emission.c,
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
mod tests {
    use super::*;

    #[test]
    fn godoc_name_prefix_survives_as_substring() {
        let comment = "// DeriveTaxIdType derive the tax ID type for a country.";
        let summary = "Derive the tax ID type for a country.";
        let haystack = normalize_doc_text(comment);
        let needle = normalize_doc_text(summary);
        assert!(
            haystack.contains(&needle),
            "haystack={haystack:?} needle={needle:?}"
        );
    }

    #[test]
    fn yard_multiline_collapses_to_one_line() {
        let yard = "# Derive the tax ID type for a country.\n#\n# @param country ISO 3166-1 alpha-2 country code.";
        let normalized = normalize_doc_text(yard);
        assert!(normalized.contains("derive the tax id type for a country."));
        assert!(normalized.contains("@param country iso 3166-1 alpha-2 country code."));
        assert!(!normalized.contains('\n'));
    }

    #[test]
    fn jsdoc_star_continuation_strips() {
        let jsdoc =
            "/**\n * Derive the tax ID type for a country.\n *\n * @param country ISO code.\n */";
        let normalized = normalize_doc_text(jsdoc);
        assert!(normalized.contains("derive the tax id type for a country."));
        assert!(normalized.contains("@param country iso code."));
    }

    #[test]
    fn one_word_difference_does_not_match() {
        let rendered = normalize_doc_text("// Derive the tax ID type for a country.");
        let other = normalize_doc_text("Derive the VAT ID type for a country.");
        assert!(!rendered.contains(&other));
    }
}
