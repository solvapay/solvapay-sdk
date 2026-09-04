# frozen_string_literal: true

module __RUBY_MODULE__
  module Cors
    EXPOSE = "WWW-Authenticate, Mcp-Session-Id"
    ALLOW_METHODS = "GET, POST, DELETE, OPTIONS"
    DEFAULT_ALLOW_HEADERS = "authorization, content-type, mcp-session-id, mcp-protocol-version, mcp-method, mcp-name"

    module_function

    def wrap(app)
      lambda do |env|
        if env["REQUEST_METHOD"] == "OPTIONS"
          return [204, cors_headers(env), []]
        end

        status, headers, body = app.call(env)
        [status, headers.merge(cors_headers(env)), body]
      end
    end

    def cors_headers(env)
      headers = { "Access-Control-Expose-Headers" => EXPOSE }
      origin = env["HTTP_ORIGIN"]
      if origin.is_a?(String) && !origin.empty?
        headers["Access-Control-Allow-Origin"] = origin
        headers["Vary"] = "Origin"
      end
      if env["REQUEST_METHOD"] == "OPTIONS"
        requested = env["HTTP_ACCESS_CONTROL_REQUEST_HEADERS"]
        headers["Access-Control-Allow-Methods"] = ALLOW_METHODS
        headers["Access-Control-Allow-Headers"] = requested.to_s.empty? ? DEFAULT_ALLOW_HEADERS : requested
        headers["Access-Control-Max-Age"] = "600"
      end
      headers
    end
  end

  module_function

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

  def serve_http!(env = ENV)
    require "puma"
    host = bind_host(env["MCP_HOST"])
    port = bind_port(env["MCP_PORT"])
    public_base_url = require_env!("MCP_PUBLIC_BASE_URL", env["MCP_PUBLIC_BASE_URL"])
    secret = require_env!("SOLVAPAY_SECRET_KEY", env["SOLVAPAY_SECRET_KEY"])
    product = env["SOLVAPAY_PRODUCT_REF"] || env["SOLVAPAY_PRODUCT"]
    product = require_env!("SOLVAPAY_PRODUCT_REF", product)
    api_base = env["SOLVAPAY_API_BASE_URL"]
    api_base = nil if api_base.nil? || api_base.empty?
    client = SolvaPay::Client.new(api_key: secret, api_base_url: api_base)
    engine = SolvaPay::Mcp::Engine.new(
      client: client,
      product_ref: product,
      public_base_url: public_base_url,
    )
    Tools.register_engine(engine, product: product)
    app = Cors.wrap(engine)
    $stdout.sync = true
    server = Puma::Server.new(app)
    server.add_tcp_listener(host, port)
    $stdout.puts "__SERVER_NAME__ listening on http://#{host}:#{port}/mcp"
    server.run.join
  end
end
