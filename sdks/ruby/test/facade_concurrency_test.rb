# frozen_string_literal: true

require "minitest/autorun"
require "solvapay"
require_relative "facade_test"

class FacadeConcurrencyTest < Minitest::Test
  class DelayedLimitsClient
    attr_reader :checks, :tracked

    def initialize
      @checks = 0
      @tracked = []
      @mutex = Mutex.new
      @release = ConditionVariable.new
      @entered = 0
      @hold = true
    end

    def check_limits(params:)
      @mutex.synchronize do
        @checks += 1
        @entered += 1
        @release.wait(@mutex) while @hold
      end
      {
        "withinLimits" => true,
        "remaining" => 1,
        "checkoutUrl" => "https://pay.example/checkout",
      }
    end

    def release!
      @mutex.synchronize do
        @hold = false
        @release.broadcast
      end
    end

    def track_usage(params:)
      @tracked << params
      { "ok" => true }
    end
  end

  def setup
    @decisions = SolvaPay::NativeDispatch.method(:call_sync)
    SolvaPay::NativeDispatch.define_singleton_method(:call_sync) do |name, args|
      case name
      when "overlay_claimed_limits"
        FacadeConcurrencyTest.overlay_claimed_limits(args)
      when "gate_next"
        FacadeTest.fake_gate_next(args)
      when "ensure_customer_next"
        FacadeTest.fake_ensure_customer_next(args)
      when "classify_customer_ref"
        args["customerRef"].to_s.start_with?("cus_") ? "backend" : "external"
      else
        raise "unexpected decision #{name}"
      end
    end
  end

  def teardown
    original = @decisions
    SolvaPay::NativeDispatch.define_singleton_method(:call_sync) { |name, args| original.call(name, args) }
  end

  def self.overlay_claimed_limits(args)
    limits = args["limits"].is_a?(Hash) ? args["limits"].dup : {}
    remaining = limits["remaining"].to_f
    within = limits["withinLimits"]
    claimed = args["claimed"].to_f
    if remaining == -1.0 || (within && remaining == 0.0)
      limits["withinLimits"] = true
      limits["remaining"] = remaining
    elsif claimed <= remaining
      limits["withinLimits"] = true
      limits["remaining"] = [remaining - claimed, 0.0].max + 1.0
    else
      limits["withinLimits"] = false
      limits["remaining"] = 0.0
    end
    limits
  end

  def test_concurrent_gates_against_remaining_one_allow_exactly_once
    client = DelayedLimitsClient.new
    facade = SolvaPay.create(api_client: client)
    n = 8
    threads = n.times.map do
      Thread.new { facade.gate("cus_concurrent", product: "prd_x") }
    end
    sleep 0.05 until client.instance_variable_get(:@entered) >= 1
    sleep 0.05
    client.release!
    results = threads.map(&:value)
    allows = results.count { |item| item.is_a?(SolvaPay::PayableAllowResult) }
    paywalls = results.count { |item| item.is_a?(SolvaPay::PayablePaywallResult) }

    assert_equal 1, client.checks
    assert_equal 1, allows
    assert_equal n - 1, paywalls
  end
end
