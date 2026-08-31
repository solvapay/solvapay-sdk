# frozen_string_literal: true

require "minitest/autorun"
require "stringio"
require_relative "../bitcoin_analytics"
require_relative "../http"

class HttpTest < Minitest::Test
  def test_options_mcp_returns_204_and_reflects_origin
    status, headers, = call_app("OPTIONS", "/mcp", "HTTP_ORIGIN" => "https://jam.example")
    assert_equal 204, status
    assert_equal "https://jam.example", header(headers, "Access-Control-Allow-Origin")
    assert_includes header(headers, "Access-Control-Expose-Headers"), "WWW-Authenticate"
    assert_includes header(headers, "Access-Control-Expose-Headers"), "Mcp-Session-Id"
  end

  def test_get_mcp_returns_405
    status, headers, = call_app("GET", "/mcp")
    assert_equal 405, status
    allow = header(headers, "Allow") || header(headers, "allow")
    assert_includes allow.to_s.upcase, "POST"
  end

  def test_missing_public_base_url_raises
    error = assert_raises(ArgumentError) { BitcoinAnalytics.require_env!("MCP_PUBLIC_BASE_URL", "") }
    assert_includes error.message, "MCP_PUBLIC_BASE_URL"
    error = assert_raises(ArgumentError) { BitcoinAnalytics.require_env!("MCP_PUBLIC_BASE_URL", nil) }
    assert_includes error.message, "MCP_PUBLIC_BASE_URL"
  end

  def test_default_bind_is_local_3030
    assert_equal "127.0.0.1", BitcoinAnalytics.bind_host(nil)
    assert_equal 3030, BitcoinAnalytics.bind_port(nil)
  end

  private

  def call_app(method, path, extra = {})
    app = BitcoinAnalytics.build_http_app(
      client: BitcoinAnalytics::MockClient.new(within_limits: true),
      product_ref: "prd_demo",
      public_base_url: "https://example.test",
      source: BitcoinAnalytics.default_fixture_source,
    )
    app.call(
      {
        "REQUEST_METHOD" => method,
        "PATH_INFO" => path,
        "QUERY_STRING" => "",
        "rack.input" => StringIO.new(""),
      }.merge(extra),
    )
  end

  def header(headers, name)
    headers[name] || headers[name.downcase] || headers[name.split("-").map(&:capitalize).join("-")]
  end
end
