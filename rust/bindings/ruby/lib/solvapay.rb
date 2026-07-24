# frozen_string_literal: true

require_relative "solvapay/version"

# Native Magnus extension defines the private envelope bridge.
begin
  require_relative "solvapay/solvapay"
rescue LoadError
  require "solvapay/solvapay"
end

require_relative "solvapay/errors"
require_relative "solvapay/results"
require_relative "solvapay/_native"
require_relative "solvapay/client"
require_relative "solvapay/helpers.generated"
require_relative "solvapay/helpers"
require_relative "solvapay/facade"

module SolvaPay
  # §7.7 load-time facade ↔ native version skew guard.
  def self._check_version_skew
    return unless respond_to?(:version)

    native = version
    return if native.nil? || native == VERSION

    raise SolvaPayError.new(
      "solvapay version skew: gem=#{VERSION.inspect} native=#{native.inspect}",
      code: "version_skew",
    )
  end
end

SolvaPay._check_version_skew
