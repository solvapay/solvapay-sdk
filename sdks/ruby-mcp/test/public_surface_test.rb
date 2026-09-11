# frozen_string_literal: true

require "json"
require "minitest/autorun"
require "mcp"
require "solvapay/mcp"

class PublicSurfaceTest < Minitest::Test
  def test_register_payable_tool_is_keyword_only_after_name
    params = SolvaPay::Mcp.method(:register_payable_tool).parameters
    assert_equal [%i[req server], %i[req name]], params.take(2)
    names = params.to_h { |kind, name| [name, kind] }
    %i[solvapay product handler title description input_schema get_customer_ref].each do |required|
      assert names.key?(required), "missing #{required}"
      assert_includes %i[key keyreq], names[required]
    end
    assert_equal :keyreq, names[:solvapay]
    assert_equal :keyreq, names[:product]
    assert_equal :keyreq, names[:handler]
  end

  def test_response_context_public_members
    %i[respond gate emit customer product].each do |name|
      assert_includes SolvaPay::Mcp::ResponseContext.instance_methods(false), name
    end
  end

  def test_mcp_sdk_major_is_v1
    major = Integer(::MCP::VERSION.split(".", 2).first)
    assert_equal 1, major
  end

  def test_define_tool_kwargs_block_receives_symbol_keys_and_response_emits_is_error
    received = nil
    server = ::MCP::Server.new(name: "surface")
    server.define_tool(
      name: "echo",
      input_schema: { properties: { message: { type: "string" } }, required: ["message"] },
    ) do |server_context: nil, **args|
      _ = server_context
      received = args
      ::MCP::Tool::Response.new([{ type: "text", text: "ok" }])
    end

    init = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "t", version: "0" },
      },
    }
    server.handle_json(JSON.generate(init))
    server.handle_json(JSON.generate({ jsonrpc: "2.0", method: "notifications/initialized" }))
    raw = server.handle_json(
      JSON.generate(
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "echo", arguments: { message: "hi" } },
        },
      ),
    )
    assert_instance_of Hash, received
    assert received.key?(:message)
    refute received.key?("message")

    dumped = ::MCP::Tool::Response.new([{ type: "text", text: "ok" }]).to_h
    assert dumped.key?(:isError) || dumped.key?("isError")
    wire = JSON.parse(raw)
    result = wire.fetch("result")
    assert result.key?("isError")
  end
end
