# frozen_string_literal: true

require "json"
require "minitest/autorun"
require "openssl"
require "socket"
require "solvapay"

# Body matches the frozen Step-4 accept fixture; smoke signs with wall clock.
FIXTURE_BODY = (
  '{"type":"purchase.created","id":"evt_fixture_1","created":1782864000,' \
  '"api_version":"2025-10-01","data":{"object":{"id":"pur_fixture_1"},' \
  '"previous_attributes":null},"livemode":false,"request":{"id":null,' \
  '"idempotency_key":null}}'
).freeze
FIXTURE_SECRET = "whsec_test_fixture_secret"
MERCHANT_JSON = '{"displayName":"Smoke Merchant","defaultCurrency":"USD"}'

class SmokeTest < Minitest::Test
  def test_version_is_string
    assert_kind_of String, SolvaPay.version
    refute_empty SolvaPay.version
  end

  def test_verify_webhook_accepts_fresh_signature
    now = Time.now.to_i
    sig = sign(FIXTURE_BODY, FIXTURE_SECRET, now)
    value = SolvaPay.verify_webhook(
      body: FIXTURE_BODY,
      signature: sig,
      secret: FIXTURE_SECRET,
    )
    assert_equal "purchase.created", value["type"]
    assert_equal "evt_fixture_1", value["id"]
  end

  def test_verify_webhook_rejects_bad_signature
    now = Time.now.to_i
    bad_sig = "t=#{now},v1=#{'f' * 64}"
    err = assert_raises(SolvaPay::Error) do
      SolvaPay.verify_webhook(
        body: FIXTURE_BODY,
        signature: bad_sig,
        secret: FIXTURE_SECRET,
      )
    end
    assert_equal "invalid_signature", err.code
  end

  def test_get_merchant_round_trip
    base = start_merchant_stub
    begin
      # Step 44: raw envelope client lives under private SolvaPay::Native.
      native_client = SolvaPay.const_get(:Native, false)::Client
      client = native_client.new("sk_test_smoke", base)
      envelope = JSON.parse(client.get_merchant("{}"))
      assert_equal true, envelope["ok"]
      assert_equal "Smoke Merchant", envelope["value"]["displayName"]
    ensure
      stop_merchant_stub
    end
  end

  def test_public_client_get_merchant_round_trip
    base = start_merchant_stub
    begin
      client = SolvaPay::Client.new(api_key: "sk_test_smoke", api_base_url: base)
      value = client.get_merchant
      assert_equal "Smoke Merchant", value["displayName"]
    ensure
      stop_merchant_stub
    end
  end

  private

  def sign(body, secret, now)
    digest = OpenSSL::HMAC.hexdigest("SHA256", secret, "#{now}.#{body}")
    "t=#{now},v1=#{digest}"
  end

  def start_merchant_stub
    @server = TCPServer.new("127.0.0.1", 0)
    port = @server.addr[1]
    @thread = Thread.new do
      loop do
        client = @server.accept
        Thread.new(client) do |sock|
          request = +""
          while (line = sock.gets)
            request << line
            break if line == "\r\n"
          end
          body = MERCHANT_JSON
          sock.write(
            "HTTP/1.1 200 OK\r\n" \
            "Content-Type: application/json\r\n" \
            "Content-Length: #{body.bytesize}\r\n" \
            "Connection: close\r\n\r\n#{body}",
          )
          sock.close
        rescue StandardError
          # stub teardown races
        end
      rescue StandardError
        break
      end
    end
    "http://127.0.0.1:#{port}"
  end

  def stop_merchant_stub
    @server&.close
    @thread&.kill
    @thread&.join(2)
  end
end
