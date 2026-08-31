# frozen_string_literal: true

require "minitest/autorun"
require "solvapay/mcp"

class WidgetTest < Minitest::Test
  def test_default_widget_has_root_mount
    html = SolvaPay::Mcp.default_mcp_app_html
    assert_includes html, 'id="root"'
  end

  def test_widget_mime_type
    assert_equal "text/html;profile=mcp-app", SolvaPay::Mcp::MCP_APP_MIME_TYPE
  end

  def test_vendored_widget_matches_canonical
    canonical = File.expand_path("../../../tools/mcp-app-widget/mcp-app.html", __dir__)
    assert_equal File.read(canonical, encoding: "UTF-8"), SolvaPay::Mcp.default_mcp_app_html
  end
end
