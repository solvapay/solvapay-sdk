# frozen_string_literal: true

module McpAuthoring
  class MockBackend
    attr_reader :checks, :gets, :creates, :tracked

    def initialize(limits)
      raise ArgumentError, "limits is required" if limits.nil?

      @limits = limits
      @checks = 0
      @gets = 0
      @creates = 0
      @tracked = []
    end

    def check_limits(params:)
      _ = params
      @checks += 1
      @limits
    end

    def track_usage(params:)
      @tracked << params
      { "ok" => true }
    end

    def get_customer(params:)
      @gets += 1
      { "customerRef" => backend_ref(params["externalRef"] || params["customerRef"] || "new") }
    end

    def create_customer(params:)
      @creates += 1
      { "customerRef" => backend_ref(params["externalRef"] || params["email"] || "new") }
    end

    def backend_ref(identity)
      identity = identity.to_s
      identity.start_with?("cus_") ? identity : "cus_#{identity}"
    end
  end

  module_function

  def project_usage(calls)
    calls.map do |call|
      metadata = call["metadata"].is_a?(Hash) ? call["metadata"] : {}
      raise "trackUsage call missing duration" unless call.key?("duration")
      raise "trackUsage call missing timestamp" unless call.key?("timestamp")
      raise "trackUsage call missing metadata.requestId" unless metadata.key?("requestId")

      {
        "outcome" => call["outcome"],
        "actionType" => call["actionType"],
        "units" => call["units"],
        "productRef" => call["productRef"],
        "customerRef" => call["customerRef"],
        "metadata" => { "action" => metadata["action"] },
      }
    end
  end
end
