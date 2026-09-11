//! Host display-mode snapshot for MCP Apps.

#![allow(clippy::missing_docs_in_private_items)]

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// MCP host display mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum McpDisplayMode {
    /// Widget / inline.
    Inline,
    /// Fullscreen hosted surface.
    Fullscreen,
    /// Picture-in-picture (advertised by some hosts; SolvaPay does not request it).
    Pip,
}

/// Payment geometry stamped on `data-rail`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum McpHostedRail {
    /// Fullscreen hosted column.
    Hosted,
    /// Inline widget.
    Inline,
}

/// Host-reported container size.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpContainerDimensions {
    /// Width in CSS pixels.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<f64>,
    /// Height in CSS pixels.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<f64>,
    /// Max width in CSS pixels.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_width: Option<f64>,
    /// Max height in CSS pixels.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_height: Option<f64>,
}

/// Host composer insets.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpSafeAreaInsets {
    /// Top inset.
    pub top: f64,
    /// Right inset.
    pub right: f64,
    /// Bottom inset.
    pub bottom: f64,
    /// Left inset.
    pub left: f64,
}

/// Display-mode snapshot plus derived hosted rail.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpDisplayModeState {
    /// Current host mode.
    pub display_mode: McpDisplayMode,
    /// Modes the host advertised.
    pub available_display_modes: Vec<McpDisplayMode>,
    /// Host container size when reported.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub container_dimensions: Option<McpContainerDimensions>,
    /// Host insets when reported.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub safe_area_insets: Option<McpSafeAreaInsets>,
    /// Payment geometry for `data-rail`.
    pub hosted_rail: McpHostedRail,
}

fn read_finite(value: Option<&Value>) -> Option<f64> {
    value.and_then(Value::as_f64).filter(|n| n.is_finite())
}

fn read_inset(value: Option<&Value>) -> f64 {
    read_finite(value).unwrap_or(0.0)
}

fn parse_mode(value: Option<&Value>) -> Option<McpDisplayMode> {
    match value.and_then(Value::as_str) {
        Some("inline") => Some(McpDisplayMode::Inline),
        Some("fullscreen") => Some(McpDisplayMode::Fullscreen),
        Some("pip") => Some(McpDisplayMode::Pip),
        _ => None,
    }
}

/// Pull display-mode fields out of a host-context object.
#[must_use]
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "none",
    section = "mcp-account",
    emit_order = 63
)]
pub fn resolve_display_mode(ctx: Option<&Value>) -> McpDisplayModeState {
    let Some(ctx) = ctx.filter(|v| v.is_object()) else {
        return McpDisplayModeState {
            display_mode: McpDisplayMode::Inline,
            available_display_modes: Vec::new(),
            container_dimensions: None,
            safe_area_insets: None,
            hosted_rail: McpHostedRail::Inline,
        };
    };
    let display_mode = parse_mode(ctx.get("displayMode")).unwrap_or(McpDisplayMode::Inline);
    let available_display_modes = ctx
        .get("availableDisplayModes")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|item| parse_mode(Some(item)))
                .collect()
        })
        .unwrap_or_default();
    let container_dimensions = ctx.get("containerDimensions").and_then(|dims| {
        if !dims.is_object() {
            return None;
        }
        let next = McpContainerDimensions {
            width: read_finite(dims.get("width")),
            height: read_finite(dims.get("height")),
            max_width: read_finite(dims.get("maxWidth")),
            max_height: read_finite(dims.get("maxHeight")),
        };
        if next.width.is_none()
            && next.height.is_none()
            && next.max_width.is_none()
            && next.max_height.is_none()
        {
            None
        } else {
            Some(next)
        }
    });
    let safe_area_insets = ctx.get("safeAreaInsets").and_then(|insets| {
        insets.is_object().then(|| McpSafeAreaInsets {
            top: read_inset(insets.get("top")),
            right: read_inset(insets.get("right")),
            bottom: read_inset(insets.get("bottom")),
            left: read_inset(insets.get("left")),
        })
    });
    let hosted_rail = if display_mode == McpDisplayMode::Fullscreen {
        McpHostedRail::Hosted
    } else {
        McpHostedRail::Inline
    };
    McpDisplayModeState {
        display_mode,
        available_display_modes,
        container_dimensions,
        safe_area_insets,
        hosted_rail,
    }
}
