# frozen_string_literal: true

require "json"
require "minitest/autorun"
require "solvapay/mcp"
require "socket"
require_relative "mcp_authoring/driver"
require_relative "mcp_authoring/mock_backend"
require_relative "mcp_authoring/repo_paths"
require_relative "mcp_authoring/scenario"

MCP_AUTHORING_FIXTURES = [
  "allow/respond-emitted-blocks.json",
  "allow/respond-key-order.json",
  "allow/respond-minimal.json",
  "allow/respond-nudge.json",
  "allow/respond-text-option.json",
  "auth-gate/allow-initialize.json",
  "auth-gate/allow-tools-call-with-bearer.json",
  "auth-gate/challenge-tools-call.json",
  "bootstrap/unauthenticated.json",
  "builtin-tools/activate-plan-no-ref.json",
  "builtin-tools/activate-plan.json",
  "builtin-tools/attach-business-details-unauth.json",
  "builtin-tools/attach-business-details.json",
  "builtin-tools/cancel-renewal-unauth.json",
  "builtin-tools/cancel-renewal.json",
  "builtin-tools/create-checkout-session-unauth.json",
  "builtin-tools/create-checkout-session.json",
  "builtin-tools/create-customer-session-unauth.json",
  "builtin-tools/create-customer-session.json",
  "builtin-tools/create-payment-intent-unauth.json",
  "builtin-tools/create-payment-intent.json",
  "builtin-tools/create-topup-payment-intent-unauth.json",
  "builtin-tools/create-topup-payment-intent.json",
  "builtin-tools/manage-account.json",
  "builtin-tools/process-payment-unauth.json",
  "builtin-tools/process-payment.json",
  "builtin-tools/reactivate-renewal-unauth.json",
  "builtin-tools/reactivate-renewal.json",
  "builtin-tools/topup.json",
  "builtin-tools/upgrade.json",
  "config-log/once.json",
  "csp/default.json",
  "csp/with-api-origin.json",
  "customer-ref/from-hook.json",
  "customer-ref/from-tool-args.json",
  "dcr/generic-reject.json",
  "dcr/unresolved-product.json",
  "descriptors/default-all-views.json",
  "descriptors/views-checkout-only.json",
  "dispatch/challenge.json",
  "dispatch/invoke-handler.json",
  "dispatch/rpc.json",
  "engine/gate-denied.json",
  "engine/initialize.json",
  "engine/invoke-handler.json",
  "engine/tools-list.json",
  "error/handler-throws.json",
  "gate/activation-required.json",
  "gate/handler-invoked.json",
  "gate/payment-required.json",
  "hide-tools/bypass-chatgpt.json",
  "hide-tools/filter-ui-audience.json",
  "narrate/activate-plan.json",
  "narrate/manage-account-active.json",
  "narrate/manage-account.json",
  "narrate/mode-auto.json",
  "narrate/mode-text.json",
  "narrate/mode-ui.json",
  "narrate/placeholder.json",
  "narrate/topup.json",
  "narrate/upgrade.json",
  "oauth-proxy/authorize.json",
  "oauth-proxy/discovery-authorization-server.json",
  "oauth-proxy/discovery-post-405.json",
  "oauth-proxy/discovery-protected-resource.json",
  "oauth-proxy/openid-404.json",
  "oauth-proxy/paths-override.json",
  "oauth-proxy/register-502.json",
  "oauth-proxy/token-502.json",
  "oauth/discovery-authorization-server.json",
  "oauth/discovery-protected-resource-mcp-path.json",
  "oauth/discovery-protected-resource.json",
  "oauth/normalize-nestjs-401.json",
  "oauth/normalize-rfc-passthrough.json",
  "overview/resource.json",
].freeze

REGISTER_PAYABLE_FIXTURES = MCP_AUTHORING_FIXTURES.select do |rel|
  rel.start_with?("allow/", "customer-ref/", "error/", "gate/")
end.freeze

CORE_OP_FIXTURES = MCP_AUTHORING_FIXTURES.reject do |rel|
  rel.start_with?("allow/", "customer-ref/", "error/", "gate/", "bootstrap/", "builtin-tools/", "oauth-proxy/", "dispatch/")
end.freeze

ASYNC_OP_FIXTURES = MCP_AUTHORING_FIXTURES.select do |rel|
  rel.start_with?("bootstrap/", "builtin-tools/", "oauth-proxy/", "dispatch/")
end.freeze

class McpAuthoringFixturesTest < Minitest::Test
  def test_discovers_the_frozen_fixture_list
    root = McpAuthoring::RepoPaths.lookup_mcp_fixtures
    discovered = root.glob("**/*.json").select(&:file?).map do |path|
      path.relative_path_from(root).to_s.tr("\\", "/")
    end.sort
    assert_equal MCP_AUTHORING_FIXTURES, discovered
  end

  REGISTER_PAYABLE_FIXTURES.each do |rel|
    define_method("test_fixture_round_trips_strict_schema_#{rel.tr("/", "_").delete_suffix(".json")}") do
      raw = load_fixture(rel)
      assert_equal "registerPayable", raw.dig("input", "fn")
      McpAuthoring::ScenarioParser.parse_scenario(raw.dig("input", "args"))
      McpAuthoring::ScenarioParser.parse_observation(raw.dig("expect", "result"))
    end

    define_method("test_replays_fixture_#{rel.tr("/", "_").delete_suffix(".json")}") do
      raw = load_fixture(rel)
      scenario = McpAuthoring::ScenarioParser.parse_scenario(raw.dig("input", "args"))
      observation = McpAuthoring::ScenarioParser.parse_observation(raw.dig("expect", "result"))
      backend = McpAuthoring::MockBackend.new(scenario.limits)
      tool_result = McpAuthoring::Driver.call_registered_payable(backend, scenario)
      usage = McpAuthoring.project_usage(backend.tracked)
      assert_equal json_norm(observation.tool_result), json_norm(tool_result)
      assert_equal json_norm(observation.usage), json_norm(usage)
    end
  end

  %w[gate/payment-required.json gate/activation-required.json gate/handler-invoked.json].each do |rel|
    define_method("test_adapter_authored_gate_copy_fails_#{rel.tr("/", "_").delete_suffix(".json")}") do
      raw = load_fixture(rel)
      scenario = McpAuthoring::ScenarioParser.parse_scenario(raw.dig("input", "args"))
      observation = McpAuthoring::ScenarioParser.parse_observation(raw.dig("expect", "result"))
      backend = McpAuthoring::MockBackend.new(scenario.limits)
      SolvaPay::Mcp.set_format_gate_override(
        lambda do |_message, _gate|
          {
            "content" => [{ "type" => "text", "text" => "adapter-authored" }],
            "isError" => false,
            "structuredContent" => { "kind" => "payment_required" },
          }
        end,
      )
      begin
        tool_result = McpAuthoring::Driver.call_registered_payable(backend, scenario)
      ensure
        SolvaPay::Mcp.set_format_gate_override(nil)
      end
      assert_equal [{ "type" => "text", "text" => "adapter-authored" }], tool_result["content"]
      refute_equal json_norm(observation.tool_result), json_norm(tool_result)
    end
  end

  CORE_OP_FIXTURES.each do |rel|
    define_method("test_replays_core_op_#{rel.tr("/", "_").delete_suffix(".json")}") do
      raw = load_fixture(rel)
      fn = raw.dig("input", "fn")
      args = raw.dig("input", "args") || {}
      expect = raw.dig("expect", "result")
      got = SolvaPay::Mcp::Core.call(fn, args)
      if fn == "mcpHandleRequest" && rel.end_with?("tools-list.json")
        assert_equal "rpc", got["kind"]
        assert got.dig("rpc", "result", "tools").length >= 8
      elsif fn == "mcpHandleRequest" && rel.end_with?("invoke-handler.json")
        assert_equal "invokeHandler", got["kind"]
        assert_equal expect["tool"], got["tool"]
        assert_equal json_norm(expect["args"]), json_norm(got["args"])
        assert_equal expect["customerRef"], got["customerRef"]
        assert got["token"].to_s.length > 8
      else
        assert_equal json_norm(expect), json_norm(got)
      end
    end
  end

  ASYNC_OP_FIXTURES.each do |rel|
    define_method("test_replays_async_op_#{rel.tr("/", "_").delete_suffix(".json")}") do
      raw = load_fixture(rel)
      fn = raw.dig("input", "fn")
      args = raw.dig("input", "args") || {}
      expect = raw.dig("expect", "result")
      unreachable = expect.is_a?(Hash) && expect["status"] == 502 && expect.dig("body", "error") == "upstream_unreachable"
      stubs = raw["http"]
      if fn == "mcpBootstrap" && (stubs.nil? || stubs.empty?)
        stubs = default_bootstrap_stubs
      end
      server = unreachable ? nil : FixtureHttp.new(Array(stubs))
      begin
        client = SolvaPay::Client.new(api_key: "sk_test_fixture", api_base_url: server ? server.url : "http://127.0.0.1:1")
        got = case fn
              when "mcpCallBuiltinTool" then client.mcp_call_builtin_tool(params: args)
              when "mcpOauthRequest" then client.mcp_oauth_request(params: args)
              when "mcpDispatch" then client.mcp_dispatch(params: args)
              when "mcpBootstrap" then client.mcp_bootstrap(params: args)
              else
                flunk("unexpected fn #{fn}")
              end
        assert_async(rel, fn, json_norm(got), json_norm(expect))
      ensure
        server&.shutdown
      end
    end
  end

  def load_fixture(rel)
    JSON.parse((McpAuthoring::RepoPaths.lookup_mcp_fixtures / rel).read(encoding: "UTF-8"))
  end

  def json_norm(value)
    JSON.parse(JSON.generate(value))
  end

  def default_bootstrap_stubs
    [
      { "method" => "GET", "path" => "/v1/sdk/platform-config", "status" => 200, "body" => { "stripePublishableKey" => "pk_test" } },
      { "method" => "GET", "path" => "/v1/sdk/merchant", "status" => 200, "body" => { "displayName" => "Acme" } },
      { "method" => "GET", "path" => "/v1/sdk/products/prd_demo", "status" => 200, "body" => { "name" => "Demo" } },
      { "method" => "GET", "path" => "/v1/sdk/products/prd_demo/plans", "status" => 200, "body" => { "plans" => [{ "name" => "Pro" }] } },
    ]
  end

  def assert_async(rel, fn, got, expect)
    if fn == "mcpOauthRequest"
      assert_equal expect["status"], got["status"]
      if expect["body"].nil?
        assert_nil got["body"]
      else
        assert_equal expect["body"], got["body"]
      end
      if rel.include?("authorize")
        loc = got.dig("headers", "location").to_s
        assert loc.end_with?("/v1/customer/auth/authorize?client_id=abc"), loc
        return
      end
      want = expect["headers"]
      if want.is_a?(Hash)
        want.each do |key, value|
          assert_equal value, got.dig("headers", key)
        end
      end
      return
    end
    if fn == "mcpDispatch" && rel.end_with?("invoke-handler.json")
      assert_equal expect["kind"], got["kind"]
      assert_equal expect["tool"], got["tool"]
      assert_equal expect["args"], got["args"]
      assert_equal expect["customerRef"], got["customerRef"]
      assert got["token"].to_s.length > 8
      return
    end
    assert_equal expect, got
  end

  class FixtureHttp
    def initialize(stubs)
      @stubs = stubs
      @server = TCPServer.new("127.0.0.1", 0)
      @url = "http://127.0.0.1:#{@server.addr[1]}"
      @thread = Thread.new { serve }
    end

    attr_reader :url

    def shutdown
      @server.close
      @thread.kill
    end

    def serve
      loop do
        client = @server.accept
        request = +""
        while (line = client.gets)
          request << line
          break if line == "\r\n"
        end
        method = request.split(" ")[0]
        path = (request.split(" ")[1] || "/").split("?", 2).first
        length = request[/Content-Length: (\d+)/i, 1].to_i
        client.read(length) if length.positive?
        stub = @stubs.find { |item| (item["method"] || "GET") == method && item["path"] == path }
        if stub.nil?
          client.print "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        else
          body = JSON.generate(stub["body"] || {})
          status = stub["status"] || 200
          client.print "HTTP/1.1 #{status} OK\r\nContent-Type: application/json\r\nContent-Length: #{body.bytesize}\r\nConnection: close\r\n\r\n#{body}"
        end
        client.close
      end
    rescue IOError
      nil
    end
  end
end
