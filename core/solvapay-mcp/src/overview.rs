//! Overview resource (`docs://solvapay/overview.md`).

use serde::Serialize;

use overview_markdown::OVERVIEW_BODY;

mod overview_markdown {
    /// Byte-exact TS/Python overview markdown.
    pub const OVERVIEW_BODY: &str = include_str!("overview.md");
}

/// Overview resource descriptor.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverviewResource {
    /// Resource URI.
    pub uri: String,
    /// MIME type.
    pub mime_type: String,
    /// Resource name.
    pub name: String,
    /// Title.
    pub title: String,
    /// Description.
    pub description: String,
    /// Markdown body.
    pub body: String,
}

/// Return the frozen overview resource (URI, metadata, body).
#[must_use]
pub fn mcp_overview_resource() -> OverviewResource {
    OverviewResource {
        uri: "docs://solvapay/overview.md".to_owned(),
        mime_type: "text/markdown".to_owned(),
        name: "SolvaPay MCP — overview".to_owned(),
        title: "SolvaPay overview".to_owned(),
        description: "Agent-facing \"start here\" doc — explains the five intent tools, dual-audience fallback, and auth model before any tool is called.".to_owned(),
        body: OVERVIEW_BODY.to_owned(),
    }
}
