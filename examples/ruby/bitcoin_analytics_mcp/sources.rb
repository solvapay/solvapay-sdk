# frozen_string_literal: true

require "json"
require "net/http"
require "timeout"
require "uri"

module BitcoinAnalytics
  WHY21MILLION = "https://why21million.com"
  MEMPOOL_SPACE = "https://mempool.space"
  BTCNODE = "https://btcnode.uk"
  USER_AGENT = "solvapay-bitcoin-analytics-mcp"
  FIXTURE_DIR = File.expand_path("fixtures", __dir__)

  class SourceError < StandardError
    attr_reader :origin, :path

    def initialize(message, origin: nil, path: nil)
      @origin = origin
      @path = path
      super(message)
    end

    def endpoint
      return message if origin.nil? || path.nil?

      "#{HttpSupport.source_name(origin)} #{path}"
    end
  end

  class UnreachableError < SourceError
    def initialize(origin, path, reason)
      super(
        "could not reach #{HttpSupport.source_name(origin)} #{path}: #{reason}",
        origin: origin,
        path: path,
      )
    end
  end

  class UpstreamPaymentRequiredError < SourceError; end

  module HttpSupport
    module_function

    def source_name(origin)
      URI.parse(origin).host || origin
    end

    def raise_for_status!(origin, path, status, body)
      label = source_name(origin)
      if Integer(status) == 402
        raise UpstreamPaymentRequiredError.new(
          "x402 payment required from #{label} #{path} (not a SolvaPay paywall)",
          origin: origin,
          path: path,
        )
      end
      return if (200..299).cover?(Integer(status))

      raise SourceError.new("#{label} #{path} returned #{status}: #{body_preview(body)}", origin: origin, path: path)
    end

    def raise_for_payload!(origin, path, payload)
      return unless payload.is_a?(Hash)
      return unless payload["success"] == false || (payload.key?("error") && !payload.key?("success"))

      message = payload["error"] || payload.inspect
      raise SourceError.new("#{source_name(origin)} #{path}: #{message}", origin: origin, path: path)
    end

    def body_preview(body)
      body.is_a?(String) ? body : JSON.generate(body)
    end

    def parse_json(body)
      body.is_a?(String) ? JSON.parse(body) : body
    end
  end

  class FixtureSource
    attr_reader :recorded

    def initialize(responses, fallback: nil)
      @responses = responses
      @fallback = fallback
      @recorded = []
    end

    def get_json(origin, path)
      request(origin, path, :json)
    end

    def get_text(origin, path)
      request(origin, path, :text)
    end

    private

    def request(origin, path, mode)
      @recorded << [origin, path]
      entry = @responses[[origin, path]]
      entry = @fallback.call(origin, path) if entry.nil? && @fallback
      raise SourceError.new("no fixture for #{origin}#{path}", origin: origin, path: path) if entry.nil?

      if entry[:unreachable]
        raise UnreachableError.new(origin, path, entry[:reason] || "no response")
      end

      status = entry.fetch(:status)
      body = entry.fetch(:body)
      HttpSupport.raise_for_status!(origin, path, status, body)
      return text_body(body) if mode == :text

      payload = HttpSupport.parse_json(body)
      HttpSupport.raise_for_payload!(origin, path, payload)
      payload
    end

    def text_body(body)
      body.is_a?(String) ? body : JSON.generate(body)
    end
  end

  class LiveSource
    DEFAULT_OPEN_TIMEOUT = 5
    DEFAULT_READ_TIMEOUT = 8

    def initialize(open_timeout: DEFAULT_OPEN_TIMEOUT, read_timeout: DEFAULT_READ_TIMEOUT)
      @open_timeout = open_timeout
      @read_timeout = read_timeout
    end

    def get_json(origin, path)
      status, body = http_get(origin, path)
      HttpSupport.raise_for_status!(origin, path, status, body)
      payload = JSON.parse(body)
      HttpSupport.raise_for_payload!(origin, path, payload)
      payload
    end

    def get_text(origin, path)
      status, body = http_get(origin, path)
      HttpSupport.raise_for_status!(origin, path, status, body)
      body
    end

    private

    def http_get(origin, path)
      uri = URI.parse("#{origin}#{path}")
      http = Net::HTTP.new(uri.host, uri.port)
      http.use_ssl = uri.scheme == "https"
      http.open_timeout = @open_timeout
      http.read_timeout = @read_timeout
      request = Net::HTTP::Get.new(uri.request_uri)
      request["User-Agent"] = USER_AGENT
      response = http.request(request)
      [response.code.to_i, response.body.to_s]
    rescue Errno::ECONNREFUSED, Errno::EHOSTUNREACH, Errno::ENETUNREACH, Errno::ECONNRESET,
           Errno::ETIMEDOUT, SocketError, Net::OpenTimeout, Net::ReadTimeout, Net::HTTPBadResponse,
           EOFError, IOError, Timeout::Error => error
      raise UnreachableError.new(origin, path, "#{error.class}: #{error.message}")
    end
  end

  class HalvingClient
    def initialize(source)
      @source = source
    end

    def at_height(height)
      @source.get_json(WHY21MILLION, "/api/halving/#{height}")
    end
  end

  class MempoolClient
    def initialize(source)
      @source = source
    end

    def tip_height
      Integer(@source.get_text(MEMPOOL_SPACE, "/api/blocks/tip/height").strip)
    end

    def tip_hash
      @source.get_text(MEMPOOL_SPACE, "/api/blocks/tip/hash").strip
    end

    def difficulty_adjustment
      @source.get_json(MEMPOOL_SPACE, "/api/v1/difficulty-adjustment")
    end

    def fees_recommended
      @source.get_json(MEMPOOL_SPACE, "/api/v1/fees/recommended")
    end

    def fees_precise
      @source.get_json(MEMPOOL_SPACE, "/api/v1/fees/precise")
    end

    def mempool_blocks
      @source.get_json(MEMPOOL_SPACE, "/api/v1/fees/mempool-blocks")
    end

    def mempool
      @source.get_json(MEMPOOL_SPACE, "/api/mempool")
    end

    def mempool_recent
      @source.get_json(MEMPOOL_SPACE, "/api/mempool/recent")
    end

    def address(addr)
      @source.get_json(MEMPOOL_SPACE, "/api/address/#{addr}")
    end

    def tx(txid)
      @source.get_json(MEMPOOL_SPACE, "/api/tx/#{txid}")
    end

    def tx_status(txid)
      @source.get_json(MEMPOOL_SPACE, "/api/tx/#{txid}/status")
    end
  end

  class BtcnodeClient
    def initialize(source)
      @source = source
    end

    def info
      @source.get_json(BTCNODE, "/api/info")
    end

    def fees
      @source.get_json(BTCNODE, "/api/fees")
    end

    def fees_predict
      @source.get_json(BTCNODE, "/api/fees/predict")
    end

    def mempool
      @source.get_json(BTCNODE, "/api/mempool")
    end

    def tx(hash)
      @source.get_json(BTCNODE, "/api/tx/#{hash}")
    end

    def trace(txid)
      @source.get_json(BTCNODE, "/api/trace/#{txid}")
    end
  end

  module_function

  def default_fixture_source
    FixtureSource.new(default_fixture_map, fallback: method(:fixture_fallback))
  end

  def default_fixture_map
    {
      [WHY21MILLION, "/api/halving/964846"] => json_fixture("halving_964846.json"),
      [MEMPOOL_SPACE, "/api/blocks/tip/height"] => text_fixture("tip_height.txt"),
      [MEMPOOL_SPACE, "/api/blocks/tip/hash"] => text_fixture("tip_hash.txt"),
      [MEMPOOL_SPACE, "/api/v1/difficulty-adjustment"] => json_fixture("difficulty_adjustment.json"),
      [MEMPOOL_SPACE, "/api/v1/fees/recommended"] => json_fixture("fees_recommended.json"),
      [MEMPOOL_SPACE, "/api/v1/fees/precise"] => json_fixture("fees_precise.json"),
      [MEMPOOL_SPACE, "/api/v1/fees/mempool-blocks"] => json_fixture("mempool_blocks.json"),
      [MEMPOOL_SPACE, "/api/mempool"] => json_fixture("mempool.json"),
      [MEMPOOL_SPACE, "/api/mempool/recent"] => json_fixture("mempool_recent.json"),
      [MEMPOOL_SPACE, "/api/address/bc1qexample"] => json_fixture("address.json"),
      [MEMPOOL_SPACE, "/api/tx/deadbeef"] => json_fixture("tx.json"),
      [MEMPOOL_SPACE, "/api/tx/deadbeef/status"] => json_fixture("tx_status.json"),
      [BTCNODE, "/api/info"] => json_fixture("btcnode_info.json"),
      [BTCNODE, "/api/fees"] => json_fixture("btcnode_fees.json"),
      [BTCNODE, "/api/fees/predict"] => json_fixture("btcnode_fees_predict.json"),
      [BTCNODE, "/api/mempool"] => json_fixture("btcnode_mempool.json"),
      [BTCNODE, "/api/tx/deadbeef"] => json_fixture("btcnode_tx.json"),
      [BTCNODE, "/api/trace/deadbeef"] => json_fixture("btcnode_trace.json"),
    }
  end

  def json_fixture(name)
    { status: 200, body: JSON.parse(File.read(File.join(FIXTURE_DIR, name))) }
  end

  def text_fixture(name)
    { status: 200, body: File.read(File.join(FIXTURE_DIR, name)).strip, mode: :text }
  end

  def fixture_fallback(origin, path)
    if origin == WHY21MILLION && path =~ %r{\A/api/halving/(-?\d+)\z}
      height = Regexp.last_match(1).to_i
      if height.negative?
        return { status: 400, body: { "error" => "height must be a non-negative integer" } }
      end

      return { status: 200, body: synthetic_halving(height) }
    end
    if origin == MEMPOOL_SPACE && path.start_with?("/api/address/")
      return json_fixture("address.json")
    end
    if origin == MEMPOOL_SPACE && path.match?(%r{\A/api/tx/[^/]+/status\z})
      return json_fixture("tx_status.json")
    end
    if origin == MEMPOOL_SPACE && path.start_with?("/api/tx/")
      return json_fixture("tx.json")
    end
    if origin == BTCNODE && path.start_with?("/api/tx/")
      return json_fixture("btcnode_tx.json")
    end
    if origin == BTCNODE && path.start_with?("/api/trace/")
      return json_fixture("btcnode_trace.json")
    end

    nil
  end

  def synthetic_halving(height)
    era = (height / 210_000) + 1
    into = height % 210_000
    reward = era >= 34 ? 0.0 : 50.0 / (2**(era - 1))
    {
      "era" => era,
      "rewardBtc" => reward,
      "blocksIntoEra" => into,
      "blocksUntilNextHalving" => 210_000 - into,
      "nextHalvingBlock" => era * 210_000,
      "source" => "fixture",
    }
  end
end
