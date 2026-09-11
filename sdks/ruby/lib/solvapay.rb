# frozen_string_literal: true

require_relative "solvapay/version"

# Native Magnus extension defines the private envelope bridge.
begin
  require_relative "solvapay/solvapay"
rescue LoadError
  require "solvapay/solvapay"
end

require_relative "solvapay/defaults"
require_relative "solvapay/errors"
require_relative "solvapay/results"
require_relative "solvapay/_native"

module SolvaPay
  # §7.7 load-time facade ↔ native version skew guard.
  def self._check_version_skew
    if respond_to?(:version)
      native = version
      if !native.nil? && native != VERSION
        raise SolvaPayError.new(
          "solvapay version skew: gem=#{VERSION.inspect} native=#{native.inspect}",
          code: "version_skew",
        )
      end
    end

    return unless defined?(Native) && defined?(NativeDispatch::SYNC_METHODS)

    available = Native.singleton_methods.map(&:to_s)
    missing = NativeDispatch::SYNC_METHODS.reject { |name| available.include?(name) }
    return if missing.empty?

    binary = $LOADED_FEATURES.find { |path| path.match?(/solvapay\.(bundle|so)\z/) }
    binary_note = binary ? " binary=#{binary}" : ""
    raise SolvaPayError.new(
      "solvapay native extension is stale: missing #{missing.join(', ')}.#{binary_note} " \
      "Recompile with: bundle exec rake compile",
      code: "version_skew",
    )
  end
end

SolvaPay._check_version_skew

require_relative "solvapay/client"
require_relative "solvapay/helpers.generated"
require_relative "solvapay/helpers"
require_relative "solvapay/facade"
