# frozen_string_literal: true

require "json"

module Contract
  module Dispatch
    API_KEY = "sk_test_fixture"

    module_function

    def replay(fixture, test:)
      name = fixture.fetch("input").fetch("fn")
      args = fixture.fetch("input").fetch("args")
      value = if name == "verifyWebhook"
                webhook(fixture)
              elsif name == "constructSdkError"
                return construct_error(fixture)
              elsif HostAdapters::HOST_FUNCTIONS.include?(name)
                HostAdapters.invoke(name, args, clock: fixture["input"]["clock"])
              else
                snake = Names.camel_to_snake(name)
                if SolvaPay::NativeDispatch::CLIENT_METHODS.include?(snake)
                  return client(fixture, snake, test: test)
                end
                if SolvaPay::NativeDispatch::SYNC_METHODS.include?(snake)
                  return sync(fixture, snake)
                end

                raise KeyError, "unsupported fixture fn: #{name}"
              end
      Compare.value_outcome(value)
    rescue SolvaPay::SolvaPayError, SolvaPay::PaywallError => error
      Compare.error_outcome(error)
    end

    def webhook(fixture)
      input = fixture.fetch("input")
      args = input.fetch("args")
      clock = input.fetch("clock")
      SolvaPay::NativeDispatch.verify_webhook_at(
        body: args.fetch("body"),
        signature: args.fetch("signature"),
        secret: args.fetch("secret"),
        now_unix_secs: Clock.unix_secs(clock),
      )
    end

    def construct_error(fixture)
      envelope = JSON.parse(
        SolvaPay::NativeDispatch.native_module.public_send(
          "_construct_sdk_error",
          JSON.generate(fixture.fetch("input").fetch("args")),
        ),
      )
      error = envelope.fetch("error")
      kind = error["kind"]
      code = error["code"]
      if kind == "Transport"
        code = error["retryable"] ? "retryable" : "non_retryable"
      end
      {
        ok: false,
        error_name: kind == "Paywall" ? "PaywallError" : "SolvaPayError",
        error_message: error.fetch("message"),
        error_status: error["status"],
        error_kind: kind,
        error_code: code,
      }
    end

    def sync(fixture, name)
      args = fixture.fetch("input").fetch("args").dup
      if name == "build_create_customer_params"
        args["nowMs"] = Clock.unix_ms(fixture.fetch("input").fetch("clock"))
      end
      value = SolvaPay::NativeDispatch.call_sync(name, args)
      if name == "validate_public_base_url" && value.is_a?(String)
        return {
          ok: false,
          error_name: "Error",
          error_message: value,
        }
      end
      Compare.value_outcome(value)
    rescue SolvaPay::SolvaPayError => error
      return { ok: false, error_name: "Error", error_message: error.message } if name == "assert_response_result"

      Compare.error_outcome(error)
    end

    def client(fixture, name, test:)
      input = fixture.fetch("input")
      clock_ms = input["clock"] ? Clock.unix_ms(input["clock"]) : nil
      rng_seed = input["rngSeed"]
      args_json = JSON.generate(input.fetch("args"))
      wire = fixture["wire"]
      unless wire
        native = fixture_client("http://127.0.0.1:1", clock_ms, rng_seed)
        return call_client(native, name, args_json)
      end

      stub = StubBackend.new(
        status: wire.fetch("response").fetch("status"),
        body: wire.fetch("response").fetch("body"),
      ).start
      begin
        native = fixture_client(stub.base_url, clock_ms, rng_seed)
        outcome = call_client(native, name, args_json)
        test.assert_equal 1, stub.captured.length, "wire fixture HTTP call count"
        StubAssertions.assert_wire(test, stub.captured.first, wire.fetch("request"))
        outcome
      ensure
        stub.stop
      end
    end

    def fixture_client(base_url, clock_ms, rng_seed)
      args = [API_KEY, base_url]
      args << clock_ms unless clock_ms.nil?
      args << rng_seed unless rng_seed.nil?
      SolvaPay::NativeDispatch.native_module
        .const_get(:Client, false)
        .public_send(:_for_fixtures, *args)
    end

    def call_client(native, name, args_json)
      Compare.value_outcome(
        SolvaPay::NativeDispatch.unwrap(native.public_send(name, args_json)),
      )
    rescue SolvaPay::SolvaPayError, SolvaPay::PaywallError => error
      Compare.error_outcome(error)
    end
  end
end
