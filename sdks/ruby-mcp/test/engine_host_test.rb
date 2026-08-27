# frozen_string_literal: true

require "json"
require "minitest/autorun"
require "solvapay"
require "solvapay/mcp"
require "socket"
require "stringio"
require_relative "mcp_authoring/repo_paths"

class EngineHostTest < Minitest::Test
  BEARER = "Bearer eyJhbGciOiJub25lIn0.eyJzdWIiOiJjdXNfMSJ9."

  def test_engine_loop_invoke_handler_then_resume
    stub = LimitsStub.new
    client = SolvaPay::Client.new(api_key: "sk_test", api_base_url: stub.url)
    engine = SolvaPay::Mcp::Engine.new(
      client: client,
      product_ref: "prd_demo",
      public_base_url: "https://app.example.com",
      resource_uri: "ui://test/view.html",
    )
    engine.register_payable(
      "echo_paid",
      product: "prd_demo",
      handler: lambda do |args, ctx|
        ctx.respond({ "echo" => stringify(args) })
      end,
    )
    status, _headers, body = engine.call(
      rack_env(
        "POST",
        "/mcp",
        JSON.generate(
          {
            jsonrpc: "2.0",
            id: 3,
            method: "tools/call",
            params: { name: "echo_paid", arguments: { n: 1 } },
          },
        ),
        "HTTP_AUTHORIZATION" => BEARER,
      ),
    )
    assert_equal 200, status
    parsed = JSON.parse(body.join)
    assert_equal 3, parsed["id"]
    echo = parsed.dig("result", "structuredContent", "echo")
    assert_equal 1, echo["n"]
    assert_equal "cus_1", echo["customer_ref"]
  ensure
    stub&.shutdown
  end

  def test_replays_dispatch_rpc_through_engine
    rel = "dispatch/rpc.json"
    raw = JSON.parse((McpAuthoring::RepoPaths.lookup_mcp_fixtures / rel).read(encoding: "UTF-8"))
    args = raw.dig("input", "args")
    expect = raw.dig("expect", "result")
    client = SolvaPay::Client.new(api_key: "sk_test_fixture", api_base_url: "http://127.0.0.1:1")
    engine = SolvaPay::Mcp::Engine.new(
      client: client,
      product_ref: args.dig("config", "productRef"),
      public_base_url: args.dig("config", "publicBaseUrl"),
      resource_uri: args.dig("config", "resourceUri"),
    )
    status, _headers, body = engine.call(
      rack_env("POST", "/mcp", JSON.generate(args["rpc"])),
    )
    assert_equal 200, status
    assert_equal expect["rpc"], JSON.parse(body.join)
  end

  def test_replays_oauth_protected_resource_through_engine
    rel = "oauth-proxy/discovery-protected-resource.json"
    raw = JSON.parse((McpAuthoring::RepoPaths.lookup_mcp_fixtures / rel).read(encoding: "UTF-8"))
    args = raw.dig("input", "args")
    expect = raw.dig("expect", "result")
    client = SolvaPay::Client.new(api_key: "sk_test_fixture", api_base_url: "http://127.0.0.1:1")
    engine = SolvaPay::Mcp::Engine.new(
      client: client,
      product_ref: args.dig("config", "productRef"),
      public_base_url: args.dig("config", "publicBaseUrl"),
      mcp_path: args.dig("config", "mcpPath"),
    )
    status, _headers, body = engine.call(
      rack_env(args["method"], args["path"], args["body"].to_s),
    )
    assert_equal expect["status"], status
    parsed = body.join.empty? ? nil : JSON.parse(body.join)
    assert_equal expect["body"], parsed
  end

  def stringify(value)
    JSON.parse(JSON.generate(value))
  end

  def rack_env(method, path, body = "", extra = {})
    uri = URI.parse(path)
    {
      "REQUEST_METHOD" => method,
      "PATH_INFO" => uri.path,
      "QUERY_STRING" => uri.query.to_s,
      "rack.input" => StringIO.new(body),
    }.merge(extra)
  end

  class LimitsStub
    def initialize
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
        path = request.split(" ")[1] || "/"
        path = path.split("?", 2).first
        length = request[/Content-Length: (\d+)/i, 1].to_i
        client.read(length) if length.positive?
        if path == "/v1/sdk/limits"
          body = JSON.generate(
            {
              "withinLimits" => true,
              "remaining" => 42,
              "plan" => "pl_pro",
              "creditBalance" => 5000,
            },
          )
        elsif path == "/v1/sdk/usages"
          body = JSON.generate({ "reference" => "usg_test", "outcome" => "success" })
        else
          client.print "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
          client.close
          next
        end
        client.print "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: #{body.bytesize}\r\nConnection: close\r\n\r\n#{body}"
        client.close
      end
    rescue IOError
      nil
    end
  end
end
