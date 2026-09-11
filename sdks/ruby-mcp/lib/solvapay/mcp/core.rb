# frozen_string_literal: true

require "json"
require "solvapay"

module SolvaPay
  module Mcp
    module Core
      class << self
        def call(opcode, args)
          envelope = JSON.parse(SolvaPay.solvapay_call(JSON.generate({ "op" => opcode, "args" => args })))
          raise SolvaPay::SolvaPayError, envelope.dig("error", "message") || "mcp op failed" unless envelope["ok"]

          envelope["value"]
        end
      end
    end
  end
end
