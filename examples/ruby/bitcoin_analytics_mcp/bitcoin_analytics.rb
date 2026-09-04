# frozen_string_literal: true

require "mcp"
require "solvapay"
require "solvapay/mcp"
require_relative "sources"
require_relative "tools"
require_relative "http"

module BitcoinAnalytics
  PRODUCT_DEFAULT = "prd_demo"

  class MockClient
    attr_reader :tracked

    def initialize(within_limits:)
      @within_limits = within_limits
      @tracked = []
    end

    def check_limits(params:)
      _ = params
      {
        "withinLimits" => @within_limits,
        "remaining" => @within_limits ? 5 : 0,
        "meterName" => "requests",
        "checkoutUrl" => "https://pay.example/x",
      }
    end

    def track_usage(params:)
      @tracked << params
      { "ok" => true }
    end

    def get_customer(params:)
      { "customerRef" => params["customerRef"] || "cus_demo" }
    end

    def create_customer(params:)
      get_customer(params: params)
    end
  end

  module_function

  def build_mcp_server(within_limits:, source:, product: PRODUCT_DEFAULT)
    solvapay = SolvaPay.create(api_client: MockClient.new(within_limits: within_limits))
    server = ::MCP::Server.new(name: "bitcoin-analytics-mcp")
    Tools.register_server(
      server,
      solvapay: solvapay,
      product: product,
      source: source,
      get_customer_ref: ->(_args) { "cus_demo" },
    )
    server
  end

  def build_http_app(client:, product_ref:, public_base_url:, source:)
    engine = SolvaPay::Mcp::Engine.new(
      client: client,
      product_ref: product_ref,
      public_base_url: public_base_url,
    )
    Tools.register_engine(engine, product: product_ref, source: source)
    Cors.wrap(engine)
  end

  def require_env!(name, value)
    raise ArgumentError, "#{name} is required" if value.nil? || value.to_s.empty?

    value
  end

  def bind_host(value)
    return "127.0.0.1" if value.nil? || value.to_s.empty?

    value
  end

  def bind_port(value)
    return 3030 if value.nil? || value.to_s.empty?

    Integer(value)
  end

  def live_source?(value)
    value.to_s == "live"
  end
end
