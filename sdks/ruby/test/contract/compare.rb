# frozen_string_literal: true

module Contract
  module Compare
    module_function

    WEBHOOK_CODES = %w[
      invalid_signature
      timestamp_too_old
      malformed_signature
      missing_signature
      invalid_payload
    ].freeze

    def value_outcome(value)
      { ok: true, value: value }
    end

    def error_outcome(error)
      if error.is_a?(SolvaPay::PaywallError)
        return {
          ok: false,
          error_name: "PaywallError",
          error_message: error.message,
          error_kind: "Paywall",
        }
      end
      if error.is_a?(SolvaPay::SolvaPayError)
        kind = error.kind
        name = "SolvaPayError"
        kind = "Api" if kind.nil? && error.status
        kind = "Webhook" if WEBHOOK_CODES.include?(error.code)
        return {
          ok: false,
          error_name: name,
          error_message: error.message,
          error_status: error.status,
          error_kind: kind,
          error_code: error.code,
        }
      end
      {
        ok: false,
        error_name: error.class.name,
        error_message: error.message,
      }
    end

    def assert_expect(test, outcome, fixture)
      expect = fixture.fetch("expect")
      if expect.key?("result")
        test.assert outcome[:ok], "expected result, got #{outcome.inspect}"
        test.assert json_equal?(outcome[:value], expect["result"]),
                    "result mismatch:\n got: #{outcome[:value].inspect}\n expected: #{expect["result"].inspect}"
        return
      end

      expected = expect.fetch("error")
      test.refute outcome[:ok], "expected error, got #{outcome.inspect}"
      test.assert_equal expected.fetch("message"), outcome[:error_message], "error message"
      {
        "name" => :error_name,
        "status" => :error_status,
        "kind" => :error_kind,
        "code" => :error_code,
      }.each do |key, actual_key|
        test.assert_equal expected[key], outcome[actual_key], "error #{key}" if expected.key?(key)
      end
    end

    def json_equal?(left, right)
      if left.is_a?(Numeric) && right.is_a?(Numeric)
        return left.to_f == right.to_f
      end
      if left.is_a?(Array) && right.is_a?(Array)
        return left.length == right.length && left.zip(right).all? { |a, b| json_equal?(a, b) }
      end
      if left.is_a?(Hash) && right.is_a?(Hash)
        return left.keys.sort == right.keys.sort &&
               left.all? { |key, value| json_equal?(value, right[key]) }
      end
      left == right
    end
  end
end
