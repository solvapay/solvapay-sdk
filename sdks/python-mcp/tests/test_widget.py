from __future__ import annotations

from pathlib import Path

from solvapay_mcp.widget import MCP_APP_MIME_TYPE, default_mcp_app_html

REPO = Path(__file__).resolve().parents[3]
CANONICAL = REPO / "tools" / "mcp-app-widget" / "mcp-app.html"


def test_default_widget_has_root_mount() -> None:
    html = default_mcp_app_html()
    assert 'id="root"' in html


def test_default_widget_mounts_the_bundled_app() -> None:
    html = default_mcp_app_html()
    assert "<script" in html
    assert "solvapay://bootstrap.json" in html


def test_widget_mime_type_matches_mcp_app_profile() -> None:
    assert MCP_APP_MIME_TYPE == "text/html;profile=mcp-app"


def test_vendored_widget_matches_canonical_artifact() -> None:
    assert default_mcp_app_html() == CANONICAL.read_text(encoding="utf-8")
