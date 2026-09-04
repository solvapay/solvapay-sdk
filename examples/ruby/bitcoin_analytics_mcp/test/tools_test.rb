# frozen_string_literal: true

require "json"
require "minitest/autorun"
require_relative "../bitcoin_analytics"

class ToolsTest < Minitest::Test
  def test_network_snapshot_allow_includes_units_and_display
    result = call_tool("network_snapshot")
    refute result["isError"]
    data = result.fetch("structuredContent")
    assert data.key?("remainingTimeMs")
    assert data.key?("heightDelta")
    display = data.fetch("display")
    assert_match(/days/, display.fetch("remainingTime"))
    assert display.key?("difficulty")
    assert_includes result["content"][0]["text"], "block"
  end

  def test_gate_round_trip
    result = call_tool("network_snapshot", within_limits: false)
    assert_equal false, result["isError"]
    assert_equal "payment_required", result["structuredContent"]["kind"]
  end

  def test_missing_address_is_tool_error
    result = call_tool("address_brief")
    assert_equal true, result["isError"]
    assert_includes result["content"][0]["text"], "address"
  end

  def test_missing_txid_is_tool_error
    result = call_tool("tx_brief")
    assert_equal true, result["isError"]
    assert_includes result["content"][0]["text"], "txid"
  end

  def test_unreachable_btcnode_still_returns_mempool_data
    source = BitcoinAnalytics::FixtureSource.new(
      BitcoinAnalytics.default_fixture_map.merge(
        [BitcoinAnalytics::BTCNODE, "/api/info"] => { unreachable: true, reason: "no response" },
      ),
      fallback: BitcoinAnalytics.method(:fixture_fallback),
    )
    result = call_tool("network_snapshot", source: source)
    refute result["isError"]
    data = result.fetch("structuredContent")
    assert_equal 964_846, data.fetch("mempoolTipHeight")
    assert_nil data.fetch("btcnodeTipHeight")
    assert_equal "not reported", data.fetch("display").fetch("btcnodeTipHeight")
    note = data.fetch("notes").join(" ")
    assert_includes note, "btcnode.uk"
    assert_includes note, "/api/info"
    text = result["content"][0]["text"]
    assert_includes text, "964,846"
    assert_includes text, "btcnode.uk /api/info"
    refute_includes (data["sources"] || []), "btcnode.uk"
  end

  def test_btcnode_info_500_still_returns_mempool_and_names_the_endpoint
    source = BitcoinAnalytics::FixtureSource.new(
      BitcoinAnalytics.default_fixture_map.merge(
        [BitcoinAnalytics::BTCNODE, "/api/info"] => { status: 500, body: "upstream down" },
      ),
      fallback: BitcoinAnalytics.method(:fixture_fallback),
    )
    result = call_tool("network_snapshot", source: source)
    refute result["isError"]
    data = result.fetch("structuredContent")
    assert_equal 964_846, data.fetch("mempoolTipHeight")
    assert_includes data.fetch("notes").join(" "), "btcnode.uk /api/info"
  end

  def test_register_engine_forwards_descriptors
    calls = []
    engine = Object.new
    engine.define_singleton_method(:register_payable) do |name, **kwargs|
      calls << [name, kwargs]
    end
    BitcoinAnalytics::Tools.register_engine(
      engine,
      product: "prd_demo",
      source: BitcoinAnalytics.default_fixture_source,
    )
    names = calls.map(&:first)
    assert_equal %w[network_snapshot halving_outlook fee_outlook mempool_health address_brief tx_brief miner_revenue_split], names
    snapshot = calls.find { |name, _| name == "network_snapshot" }
    refute_nil snapshot
    assert_equal "Network snapshot", snapshot[1][:title]
    assert_includes snapshot[1][:description], "Tip height"
    assert_nil snapshot[1][:input_schema]
    address = calls.find { |name, _| name == "address_brief" }
    refute_nil address
    assert_equal "Address brief", address[1][:title]
    assert_equal({ type: "object", properties: { address: { type: "string" } }, required: ["address"] }, address[1][:input_schema])
  end

  def test_address_brief_and_tx_brief_succeed_with_args
    address = call_tool("address_brief", arguments: { address: "bc1qexample" })
    refute address["isError"]
    assert address["structuredContent"].key?("confirmedBalanceSats")
    assert address["structuredContent"]["display"].key?("confirmedBalance")

    tx = call_tool("tx_brief", arguments: { txid: "deadbeef", trace: true })
    refute tx["isError"]
    assert_equal 601_499, tx["structuredContent"]["derivedConfirmations"]
  end

  private

  def call_tool(name, arguments: {}, within_limits: true, source: nil)
    server = BitcoinAnalytics.build_mcp_server(
      within_limits: within_limits,
      source: source || BitcoinAnalytics.default_fixture_source,
    )
    server.handle_json(
      JSON.generate(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "bitcoin-analytics-test", version: "0.0.0" },
          },
        },
      ),
    )
    server.handle_json(JSON.generate({ jsonrpc: "2.0", method: "notifications/initialized" }))
    raw = server.handle_json(
      JSON.generate(
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: name, arguments: arguments },
        },
      ),
    )
    raise "tools/call returned no JSON" if raw.nil?

    dumped = JSON.parse(raw).fetch("result")
    projected = { "content" => dumped.fetch("content") }
    projected["structuredContent"] = dumped["structuredContent"] if dumped.key?("structuredContent")
    projected["isError"] = dumped["isError"] if dumped.key?("isError")
    projected
  end
end
