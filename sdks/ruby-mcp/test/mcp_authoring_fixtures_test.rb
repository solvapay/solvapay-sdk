# frozen_string_literal: true

require "json"
require "minitest/autorun"
require "solvapay/mcp"
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
  "customer-ref/from-hook.json",
  "customer-ref/from-tool-args.json",
  "error/handler-throws.json",
  "gate/activation-required.json",
  "gate/handler-invoked.json",
  "gate/payment-required.json",
].freeze

class McpAuthoringFixturesTest < Minitest::Test
  def test_discovers_the_frozen_fixture_list
    root = McpAuthoring::RepoPaths.lookup_mcp_fixtures
    discovered = root.glob("**/*.json").select(&:file?).map do |path|
      path.relative_path_from(root).to_s.tr("\\", "/")
    end.sort
    assert_equal MCP_AUTHORING_FIXTURES, discovered
  end

  MCP_AUTHORING_FIXTURES.each do |rel|
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

  def load_fixture(rel)
    JSON.parse((McpAuthoring::RepoPaths.lookup_mcp_fixtures / rel).read)
  end

  def json_norm(value)
    JSON.parse(JSON.generate(value))
  end
end
