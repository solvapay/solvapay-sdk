# frozen_string_literal: true

require "time"

module Contract
  module Clock
    module_function

    def unix_secs(value)
      Time.iso8601(value).to_i
    rescue ArgumentError
      raise ArgumentError, "input.clock must be YYYY-MM-DDTHH:MM:SSZ, got #{value.inspect}"
    end

    def unix_ms(value)
      unix_secs(value) * 1_000
    end
  end
end
