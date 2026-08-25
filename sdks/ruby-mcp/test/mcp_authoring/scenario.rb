# frozen_string_literal: true

module McpAuthoring
  class ScenarioError < StandardError; end

  ToolScenario = Struct.new(:name, :title, :description, :input_schema, :args, keyword_init: true)
  HandlerRespond = Struct.new(:kind, :data, :options, :emit, keyword_init: true)
  HandlerGate = Struct.new(:kind, :reason, keyword_init: true)
  HandlerThrow = Struct.new(:kind, :message, keyword_init: true)
  Scenario = Struct.new(
    :tool,
    :product,
    :customer_ref,
    :customer_ref_source,
    :limits,
    :handler,
    keyword_init: true,
  )
  Observation = Struct.new(:tool_result, :usage, keyword_init: true)

  LIMITS_KEYS = %w[
    withinLimits remaining plan creditBalance checkoutUrl activationRequired
    confirmationUrl plans balance product meterName
  ].freeze
  TOOL_KEYS = %w[name title description inputSchema args].freeze
  SCENARIO_KEYS = %w[tool product customerRef customerRefSource limits handler].freeze
  RESPOND_KEYS = %w[kind data options emit].freeze
  GATE_KEYS = %w[kind reason].freeze
  THROW_KEYS = %w[kind message].freeze
  OPTIONS_KEYS = %w[text nudge units].freeze
  NUDGE_KEYS = %w[kind message].freeze
  OBSERVATION_KEYS = %w[toolResult usage].freeze
  TOOL_RESULT_KEYS = %w[content structuredContent isError _meta].freeze
  USAGE_KEYS = %w[outcome actionType units productRef customerRef metadata].freeze

  module ScenarioParser
    module_function

    def parse_scenario(args)
      raise ScenarioError, "scenario args must be an object" unless args.is_a?(Hash)

      reject_unknown(args, SCENARIO_KEYS, "scenario")
      require_keys(args, %w[tool product customerRef customerRefSource limits handler], "scenario")
      product = args["product"]
      customer_ref = args["customerRef"]
      source = args["customerRefSource"]
      raise ScenarioError, "product must be a non-empty string" unless product.is_a?(String) && !product.empty?
      unless customer_ref.is_a?(String) && !customer_ref.empty?
        raise ScenarioError, "customerRef must be a non-empty string"
      end
      unless %w[hook toolArgs].include?(source)
        raise ScenarioError, "customerRefSource must be hook or toolArgs"
      end

      Scenario.new(
        tool: parse_tool(args["tool"]),
        product: product,
        customer_ref: customer_ref,
        customer_ref_source: source,
        limits: parse_limits(args["limits"]),
        handler: parse_handler(args["handler"]),
      )
    end

    def parse_observation(result)
      raise ScenarioError, "observation must be an object" unless result.is_a?(Hash)

      reject_unknown(result, OBSERVATION_KEYS, "observation")
      require_keys(result, %w[toolResult usage], "observation")
      tool_result = result["toolResult"]
      raise ScenarioError, "toolResult must be an object" unless tool_result.is_a?(Hash)

      reject_unknown(tool_result, TOOL_RESULT_KEYS, "toolResult")
      require_keys(tool_result, %w[content], "toolResult")
      usage = result["usage"]
      raise ScenarioError, "usage must be an array" unless usage.is_a?(Array)

      usage.each { |item| parse_usage_item(item) }
      Observation.new(tool_result: tool_result, usage: usage)
    end

    def parse_tool(raw)
      raise ScenarioError, "tool must be an object" unless raw.is_a?(Hash)

      reject_unknown(raw, TOOL_KEYS, "tool")
      require_keys(raw, %w[name args], "tool")
      name = raw["name"]
      raise ScenarioError, "tool.name must be a non-empty string" unless name.is_a?(String) && !name.empty?
      raise ScenarioError, "tool.args must be an object" unless raw["args"].is_a?(Hash)

      ToolScenario.new(
        name: name,
        title: optional_string(raw["title"], "tool.title"),
        description: optional_string(raw["description"], "tool.description"),
        input_schema: raw["inputSchema"],
        args: raw["args"],
      )
    end

    def parse_limits(raw)
      raise ScenarioError, "limits must be an object" unless raw.is_a?(Hash)

      reject_unknown(raw, LIMITS_KEYS, "limits")
      require_keys(raw, %w[withinLimits], "limits")
      raw
    end

    def parse_handler(raw)
      raise ScenarioError, "handler must be an object" unless raw.is_a?(Hash)

      case raw["kind"]
      when "respond"
        reject_unknown(raw, RESPOND_KEYS, "handler")
        require_keys(raw, %w[kind data], "handler")
        if raw.key?("options") && !raw["options"].nil?
          raise ScenarioError, "handler.options must be an object" unless raw["options"].is_a?(Hash)

          reject_unknown(raw["options"], OPTIONS_KEYS, "handler.options")
          if raw["options"].key?("nudge") && !raw["options"]["nudge"].nil?
            nudge = raw["options"]["nudge"]
            raise ScenarioError, "nudge must be an object" unless nudge.is_a?(Hash)

            reject_unknown(nudge, NUDGE_KEYS, "nudge")
          end
        end
        HandlerRespond.new(kind: "respond", data: raw["data"], options: raw["options"], emit: raw["emit"])
      when "gate"
        reject_unknown(raw, GATE_KEYS, "handler")
        require_keys(raw, %w[kind], "handler")
        HandlerGate.new(kind: "gate", reason: raw["reason"])
      when "throw"
        reject_unknown(raw, THROW_KEYS, "handler")
        require_keys(raw, %w[kind message], "handler")
        message = raw["message"]
        raise ScenarioError, "handler.message must be a string" unless message.is_a?(String)

        HandlerThrow.new(kind: "throw", message: message)
      else
        raise ScenarioError, "unknown handler kind"
      end
    end

    def parse_usage_item(raw)
      raise ScenarioError, "usage item must be an object" unless raw.is_a?(Hash)

      reject_unknown(raw, USAGE_KEYS, "usage")
      require_keys(raw, %w[outcome actionType units productRef customerRef metadata], "usage")
    end

    def reject_unknown(hash, allowed, label)
      extra = hash.keys.map(&:to_s) - allowed
      raise ScenarioError, "unknown keys on #{label}: #{extra.join(", ")}" unless extra.empty?
    end

    def require_keys(hash, keys, label)
      keys.each do |key|
        raise ScenarioError, "#{label} missing #{key}" unless hash.key?(key)
      end
    end

    def optional_string(value, label)
      return nil if value.nil?
      raise ScenarioError, "#{label} must be a string" unless value.is_a?(String)

      value
    end
  end
end
