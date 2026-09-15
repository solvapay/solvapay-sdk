# frozen_string_literal: true

module __RUBY_MODULE__
  module Tools
    module_function

    def register_engine(engine, product:)
      engine.register_payable(
        "__TOOL_NAME__",
        product: product,
        title: "__TOOL_NAME__",
        description:
          "Placeholder paid tool — echoes the input message so you can verify " \
          "the paywall is wired before writing real logic. 1 credit per call; " \
          "when gated, text-only narration names `account` (or `activate_plan` " \
          "when a planRef is known).",
        input_schema: {
          type: "object",
          properties: { message: { type: "string" } },
        },
        handler: lambda { |args, ctx|
          message = args.is_a?(Hash) ? (args["message"] || args[:message]) : nil
          ctx.respond({ "ok" => true, "echoed" => message || "hello" })
        },
      )
    end
  end
end
