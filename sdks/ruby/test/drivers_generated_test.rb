# frozen_string_literal: true

require "minitest/autorun"
require "solvapay"
require "solvapay/drivers.generated"

class DriversGeneratedTest < Minitest::Test
  class Host
    attr_reader :events

    def initialize
      @events = []
    end

    def ensure_customer(_ref)
      raise "ensure should not run"
    end

    def read_limits_cache(_key)
      { remaining: 5, limits: { "withinLimits" => true, "remaining" => 5 }, timestamp: 1_000 }
    end

    def check_limits(_action)
      raise "checkLimits should not run"
    end

    def apply_cache(_cache)
      @events << "cache"
    end

    def now_ms
      1_010
    end
  end

  def test_driver_loop_corpus_is_complete
    root = File.expand_path("../../../contract/fixtures/driver-loop", __dir__)
    files = Dir.glob(File.join(root, "*.json"))
    assert_equal 8, files.length
  end

  def test_generated_gate_loop_cache_hit_allow
    host = Host.new
    steps = [
      { "state" => { "product" => "prd_1" }, "action" => { "kind" => "readLimitsCache", "key" => "k" } },
      { "state" => { "product" => "prd_1" }, "action" => { "kind" => "allow", "customerRef" => "cus_1" } },
    ]
    index = 0
    out = SolvaPay::GeneratedGateLoop.run(
      gate_next: lambda { |_state, event|
        host.events << event
        step = steps[index]
        index += 1
        step
      },
      host: host,
      start_event: { "kind" => "start", "customerRef" => "cus_1" },
    )
    assert_equal "allow", out["action"]["kind"]
    assert_includes host.events, "cache"
  end

  class PayableHost
    attr_reader :tracked

    def initialize
      @tracked = []
    end

    def run_gate(_action)
      { kind: :allow, customerRef: "cus_1", limits: { "remaining" => 4 } }
    end

    def invoke_handler(_action)
      { kind: :ok, envelope: { "value" => true } }
    end

    def track_usage(request)
      @tracked << request
    end

    def now_ms
      50
    end

    def random_unit
      0.25
    end
  end

  def test_generated_payable_loop_run_gate_invoke_done
    host = PayableHost.new
    steps = [
      { "state" => {}, "action" => { "kind" => "runGate", "customerRef" => "cus_1", "product" => "prd", "usageType" => "requests" } },
      { "state" => {}, "action" => { "kind" => "invokeHandler", "customerRef" => "cus_1", "limits" => {} } },
      { "state" => {}, "action" => { "kind" => "done", "result" => { "ok" => true }, "track" => { "request" => { "units" => 1 } } } },
    ]
    index = 0
    out = SolvaPay::GeneratedPayableLoop.run(
      payable_next: lambda { |_state, _event|
        step = steps[index]
        index += 1
        step
      },
      host: host,
      start_event: { "kind" => "start", "customerRef" => "cus_1" },
    )
    assert_equal({ "ok" => true }, out)
    assert_equal([{ "units" => 1 }], host.tracked)
  end
end
