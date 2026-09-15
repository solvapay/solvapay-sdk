# frozen_string_literal: true

module SolvaPay
  # Canonical public SDK error for API, webhook, transport, and binding failures.
  class SolvaPayError < StandardError
    attr_reader :code, :status, :kind, :retryable

    def initialize(message, code: nil, status: nil, kind: nil, retryable: nil)
      super(message)
      @code = code
      @status = status
      @kind = kind
      @retryable = retryable
    end
  end

  # Structured payment gate returned by the core.
  class PaywallError < SolvaPayError
    attr_reader :structured_content

    def initialize(message, structured_content = {})
      super(message, code: "paywall", kind: "Paywall", retryable: false)
      @structured_content = structured_content
    end
  end

  # The native extension raises this name for webhook failures. Keep it as an
  # alias so all public errors share one hierarchy and one attribute contract.
  remove_const(:Error) if const_defined?(:Error, false) && const_get(:Error, false) != SolvaPayError
  Error = SolvaPayError unless const_defined?(:Error, false)
end
