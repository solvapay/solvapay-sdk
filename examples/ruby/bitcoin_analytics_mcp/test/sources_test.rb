# frozen_string_literal: true

require "json"
require "minitest/autorun"
require "socket"
require "solvapay"
require_relative "../sources"

class SourcesTest < Minitest::Test
  WHY = "https://why21million.com"
  MEMPOOL = "https://mempool.space"
  BTCNODE = "https://btcnode.uk"

  def test_fixture_get_records_origin_and_path
    source = BitcoinAnalytics::FixtureSource.new(
      {
        [MEMPOOL, "/api/blocks/tip/height"] => { status: 200, body: "964846", mode: :text },
        [BTCNODE, "/api/info"] => { status: 200, body: { "success" => true, "blocks" => 964_846 } },
      },
    )
    assert_equal "964846", source.get_text(MEMPOOL, "/api/blocks/tip/height")
    assert_equal 964_846, source.get_json(BTCNODE, "/api/info").fetch("blocks")
    assert_equal [[MEMPOOL, "/api/blocks/tip/height"], [BTCNODE, "/api/info"]], source.recorded
  end

  def test_tip_height_does_not_json_parse
    source = BitcoinAnalytics::FixtureSource.new(
      { [MEMPOOL, "/api/blocks/tip/height"] => { status: 200, body: "964846", mode: :text } },
    )
    client = BitcoinAnalytics::MempoolClient.new(source)
    assert_equal 964_846, client.tip_height
  end

  def test_unreachable_fixture_names_endpoint
    source = BitcoinAnalytics::FixtureSource.new(
      { [BTCNODE, "/api/info"] => { unreachable: true, reason: "no response" } },
    )
    error = assert_raises(BitcoinAnalytics::UnreachableError) { source.get_json(BTCNODE, "/api/info") }
    assert_includes error.message, "btcnode.uk"
    assert_includes error.message, "/api/info"
    assert_equal "btcnode.uk /api/info", error.endpoint
  end

  def test_live_source_times_out_without_a_response
    server = TCPServer.new("127.0.0.1", 0)
    port = server.addr[1]
    thread = Thread.new do
      loop do
        client = server.accept
        Thread.new(client) { |sock| sleep 2 }
      rescue StandardError
        break
      end
    end

    begin
      source = BitcoinAnalytics::LiveSource.new(open_timeout: 0.2, read_timeout: 0.2)
      error = assert_raises(BitcoinAnalytics::UnreachableError) do
        source.get_json("http://127.0.0.1:#{port}", "/api/info")
      end
    ensure
      server.close
      thread.kill
      thread.join
    end

    assert_includes error.message, "/api/info"
    assert_includes error.message, "127.0.0.1"
  end

  def test_http_500_raises_with_source_name
    source = BitcoinAnalytics::FixtureSource.new(
      { [BTCNODE, "/api/info"] => { status: 500, body: "boom" } },
    )
    error = assert_raises(BitcoinAnalytics::SourceError) { source.get_json(BTCNODE, "/api/info") }
    assert_includes error.message, "btcnode.uk"
    assert_includes error.message, "500"
  end

  def test_success_false_raises_upstream_text
    source = BitcoinAnalytics::FixtureSource.new(
      {
        [BTCNODE, "/api/addr/x"] => {
          status: 200,
          body: { "success" => false, "error" => "Multiple wallets are loaded..." },
        },
      },
    )
    error = assert_raises(BitcoinAnalytics::SourceError) { source.get_json(BTCNODE, "/api/addr/x") }
    assert_includes error.message, "Multiple wallets are loaded"
  end

  def test_http_402_names_x402_and_is_not_paywall_error
    source = BitcoinAnalytics::FixtureSource.new(
      { [BTCNODE, "/api/whales"] => { status: 402, body: { "error" => "payment-required" } } },
    )
    error = assert_raises(BitcoinAnalytics::UpstreamPaymentRequiredError) { source.get_json(BTCNODE, "/api/whales") }
    assert_includes error.message, "x402"
    assert_includes error.message, "/api/whales"
    refute_kind_of SolvaPay::PaywallError, error
    assert_raises(BitcoinAnalytics::UpstreamPaymentRequiredError) do
      raise error
    end
    refute_equal SolvaPay::PaywallError, error.class
  end

  def test_why21million_400_raises
    source = BitcoinAnalytics::FixtureSource.new(
      {
        [WHY, "/api/halving/-1"] => {
          status: 400,
          body: { "error" => "height must be a non-negative integer" },
        },
      },
    )
    error = assert_raises(BitcoinAnalytics::SourceError) { source.get_json(WHY, "/api/halving/-1") }
    assert_includes error.message, "why21million.com"
    assert_includes error.message, "400"
  end

  def test_live_source_uses_local_tcpserver
    paths = []
    server = TCPServer.new("127.0.0.1", 0)
    port = server.addr[1]
    thread = Thread.new do
      loop do
        client = server.accept
        Thread.new(client) do |sock|
          request = +""
          while (line = sock.gets)
            request << line
            break if line == "\r\n"
          end
          path = request.lines.first.to_s.split[1]
          paths << path
          assert_includes request, "solvapay-bitcoin-analytics-mcp"
          body = '{"success":true,"blocks":1}'
          sock.write(
            "HTTP/1.1 200 OK\r\n" \
            "Content-Type: application/json\r\n" \
            "Content-Length: #{body.bytesize}\r\n" \
            "Connection: close\r\n\r\n#{body}",
          )
          sock.close
        rescue StandardError
          # ignore closed connections during shutdown
        end
      rescue StandardError
        break
      end
    end

    begin
      source = BitcoinAnalytics::LiveSource.new
      payload = source.get_json("http://127.0.0.1:#{port}", "/api/info")
    ensure
      server.close
      thread.kill
      thread.join
    end

    assert_equal 1, payload.fetch("blocks")
    assert_equal ["/api/info"], paths
  end

  def test_btcnode_addr_error_fixture_raises
    body = JSON.parse(File.read(File.join(BitcoinAnalytics::FIXTURE_DIR, "btcnode_addr_error.json")))
    source = BitcoinAnalytics::FixtureSource.new(
      { [BTCNODE, "/api/addr/bc1qexample"] => { status: 200, body: body } },
    )
    error = assert_raises(BitcoinAnalytics::SourceError) { source.get_json(BTCNODE, "/api/addr/bc1qexample") }
    assert_includes error.message, "Multiple wallets"
  end

  def test_mempool_fixture_omits_fee_histogram
    mempool = JSON.parse(File.read(File.join(BitcoinAnalytics::FIXTURE_DIR, "mempool.json")))
    refute mempool.key?("fee_histogram")
  end

  def test_default_fixture_paths_exclude_forbidden_endpoints
    source = BitcoinAnalytics::default_fixture_source
    clients_exercise(source)
    joined = source.recorded.map { |origin, path| "#{origin}#{path}" }.join("\n")
    %w[reddit scrape summarize sec/insider agent/taint whales].each do |banned|
      refute_includes joined, banned
    end
    refute(source.recorded.any? { |origin, path| origin.include?("btcnode.uk") && path.start_with?("/api/addr") })
  end

  private

  def clients_exercise(source)
    BitcoinAnalytics::HalvingClient.new(source).at_height(964_846)
    mempool = BitcoinAnalytics::MempoolClient.new(source)
    mempool.tip_height
    mempool.tip_hash
    mempool.difficulty_adjustment
    mempool.fees_recommended
    mempool.fees_precise
    mempool.mempool_blocks
    mempool.mempool
    mempool.mempool_recent
    mempool.address("bc1qexample")
    mempool.tx("deadbeef")
    mempool.tx_status("deadbeef")
    btcnode = BitcoinAnalytics::BtcnodeClient.new(source)
    btcnode.info
    btcnode.fees
    btcnode.fees_predict
    btcnode.mempool
    btcnode.tx("deadbeef")
    btcnode.trace("deadbeef")
  end
end
