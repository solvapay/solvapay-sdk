# frozen_string_literal: true

require "minitest/autorun"
require "socket"
require "solvapay"
require_relative "../get_merchant"

class GetMerchantExampleTest < Minitest::Test
  def test_run_returns_get_merchant_fields
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
          body = '{"displayName":"Example Merchant","defaultCurrency":"usd"}'
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
      client = SolvaPay::Client.new(api_key: "sk_test", api_base_url: "http://127.0.0.1:#{port}")
      merchant = GetMerchant.run(client)
    ensure
      server.close
      thread.kill
      thread.join
    end

    assert_equal "Example Merchant", merchant["displayName"]
    assert_equal "usd", merchant["defaultCurrency"]
    assert_equal ["/v1/sdk/merchant"], paths
  end
end
