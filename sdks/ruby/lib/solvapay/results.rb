# frozen_string_literal: true

module SolvaPay
  class PayablePaywallResult
    attr_reader :kind, :content

    def initialize(content:)
      @kind = "paywall"
      @content = content.freeze
      freeze
    end
  end

  class PayableAllowResult
    attr_reader :kind, :customer_ref, :decision

    def initialize(customer_ref:, decision:, track_success:, track_fail:)
      @kind = "allow"
      @customer_ref = customer_ref
      @decision = decision.freeze
      @track_success = track_success
      @track_fail = track_fail
    end

    def track_success(duration: nil, metadata: nil)
      @track_success.call(duration: duration, metadata: metadata)
    end

    def track_fail(error, duration: nil, metadata: nil)
      @track_fail.call(error, duration: duration, metadata: metadata)
    end
  end
end
