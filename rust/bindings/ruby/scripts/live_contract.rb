#!/usr/bin/env ruby
# frozen_string_literal: true

# Step 45 — live Ruby contract driver (stdlib-only).
#
# Mirrors `rust/bindings/python/scripts/live_contract.py` / shadow-python.yml,
# but drives the public Ruby client against a real backend.
#
# Env:
#   SOLVAPAY_SHADOW_BASE_URL   required
#   SOLVAPAY_SHADOW_API_KEY    required
#   SOLVAPAY_SHADOW_ENABLE_STRIPE  optional (`true` / `1`) to run requires:stripe
#   SOLVAPAY_LIVE_OUT          optional report path
#     (default: contract/shadow/output/ruby-live-report.json)

require "fileutils"
require "json"
require "securerandom"
require "time"

require_relative "../lib/solvapay"

module SolvaPay
  module LiveContract
    module_function

    REPO_ROOT = File.expand_path("../../../../", __dir__) # rust/bindings/ruby/scripts → repo
    DEFAULT_OUT = File.join(REPO_ROOT, "contract", "shadow", "output", "ruby-live-report.json")

    Scenario = Struct.new(
      :id,
      :op,
      :args,
      :requires,
      :expect_error,
      :skip_reason,
      keyword_init: true,
    )

    # Port of contract/shadow/scenarios.ts — keep dependency order (setup first, deletes last).
    SCENARIOS = [
      Scenario.new(id: "getMerchant", op: "getMerchant", args: {}),
      Scenario.new(id: "getPlatformConfig", op: "getPlatformConfig", args: {}),
      Scenario.new(
        id: "createProduct",
        op: "createProduct",
        args: { "name" => "Shadow Product Scenario {sideTag}", "config" => {}, "metadata" => {} },
      ),
      Scenario.new(id: "listProducts", op: "listProducts", args: {}),
      Scenario.new(id: "getProduct", op: "getProduct", args: { "productRef" => "{productRef}" }),
      Scenario.new(
        id: "updateProduct",
        op: "updateProduct",
        args: { "productRef" => "{productRef}", "name" => "Shadow Product Updated {sideTag}" },
      ),
      Scenario.new(
        id: "cloneProduct",
        op: "cloneProduct",
        args: { "productRef" => "{productRef}", "name" => "Shadow Product Clone {sideTag}" },
        # Sandbox currently rejects clone without providerId (structured 500).
        expect_error: true,
      ),
      Scenario.new(
        id: "bootstrapMcpProduct",
        op: "bootstrapMcpProduct",
        args: { "originUrl" => "https://mcp.shadow.example.com", "metadata" => {} },
        expect_error: true,
      ),
      Scenario.new(
        id: "configureMcpPlans",
        op: "configureMcpPlans",
        args: { "productRef" => "{productRef}", "plans" => [] },
        expect_error: true,
      ),
      Scenario.new(
        id: "createPlan",
        op: "createPlan",
        args: {
          "productRef" => "{productRef}",
          "name" => "Shadow Plan",
          "type" => "recurring",
          "billingCycle" => "monthly",
          "price" => 1000,
          "currency" => "usd",
        },
      ),
      Scenario.new(id: "listPlans", op: "listPlans", args: { "productRef" => "{productRef}" }),
      Scenario.new(
        id: "updatePlan",
        op: "updatePlan",
        args: {
          "productRef" => "{productRef}",
          "planRef" => "{planRef}",
          "name" => "Shadow Plan Updated",
        },
      ),
      Scenario.new(
        id: "createCustomer",
        op: "createCustomer",
        args: { "email" => "shadow-create-{sideTag}@example.com" },
      ),
      Scenario.new(id: "getCustomer", op: "getCustomer", args: { "customerRef" => "{customerRef}" }),
      Scenario.new(
        id: "updateCustomer",
        op: "updateCustomer",
        args: { "customerRef" => "{customerRef}", "name" => "Shadow Customer" },
      ),
      Scenario.new(
        id: "assignCredits",
        op: "assignCredits",
        args: { "customerRef" => "{customerRef}", "credits" => 25 },
      ),
      Scenario.new(
        id: "getCustomerBalance",
        op: "getCustomerBalance",
        args: { "customerRef" => "{customerRef}" },
      ),
      Scenario.new(
        id: "getUserInfo",
        op: "getUserInfo",
        args: { "customerRef" => "{customerRef}", "productRef" => "{productRef}" },
      ),
      Scenario.new(
        id: "checkLimits",
        op: "checkLimits",
        args: { "customerRef" => "{customerRef}", "productRef" => "{productRef}" },
      ),
      Scenario.new(
        id: "trackUsage",
        op: "trackUsage",
        args: { "customerRef" => "{customerRef}", "actionType" => "api_call", "units" => 1 },
      ),
      Scenario.new(
        id: "trackUsageBulk",
        op: "trackUsageBulk",
        args: {
          "events" => [
            { "customerRef" => "{customerRef}", "actionType" => "api_call", "units" => 1 },
          ],
        },
      ),
      Scenario.new(
        id: "createCheckoutSession",
        op: "createCheckoutSession",
        args: { "productRef" => "{productRef}", "customerRef" => "{customerRef}" },
      ),
      Scenario.new(
        id: "createCustomerSession",
        op: "createCustomerSession",
        args: { "customerRef" => "{customerRef}" },
      ),
      Scenario.new(
        id: "activatePlan",
        op: "activatePlan",
        args: {
          "customerRef" => "{customerRef}",
          "productRef" => "{productRef}",
          "planRef" => "{planRef}",
        },
      ),
      Scenario.new(
        id: "createPaymentIntent",
        op: "createPaymentIntent",
        args: {
          "productRef" => "{productRef}",
          "planRef" => "{planRef}",
          "customerRef" => "{customerRef}",
        },
        requires: :stripe,
        skip_reason: "requires: stripe",
      ),
      Scenario.new(
        id: "createTopupPaymentIntent",
        op: "createTopupPaymentIntent",
        args: {
          "customerRef" => "{customerRef}",
          "productRef" => "{productRef}",
          "amount" => 500,
          "currency" => "USD",
        },
        requires: :stripe,
        skip_reason: "requires: stripe",
      ),
      Scenario.new(
        id: "processPaymentIntent",
        op: "processPaymentIntent",
        args: {
          "processorPaymentId" => "{paymentIntentId}",
          "customerRef" => "{customerRef}",
        },
        requires: :stripe,
        skip_reason: "requires: stripe",
      ),
      Scenario.new(
        id: "attachBusinessDetails",
        op: "attachBusinessDetails",
        args: {
          "paymentIntentId" => "{paymentIntentId}",
          "businessName" => "Shadow Co",
          "country" => "US",
        },
        requires: :stripe,
        skip_reason: "requires: stripe",
      ),
      Scenario.new(
        id: "cancelPurchase",
        op: "cancelPurchase",
        args: { "purchaseRef" => "{purchaseRef}" },
        requires: :active_purchase,
        skip_reason: "requires: activePurchase",
      ),
      Scenario.new(
        id: "reactivatePurchase",
        op: "reactivatePurchase",
        args: { "purchaseRef" => "{purchaseRef}" },
        requires: :active_purchase,
        skip_reason: "requires: activePurchase",
      ),
      Scenario.new(
        id: "getPaymentMethod",
        op: "getPaymentMethod",
        args: { "customerRef" => "{customerRef}" },
        requires: :stripe,
        skip_reason: "requires: stripe (Stripe customer)",
      ),
      Scenario.new(
        id: "getAutoRecharge",
        op: "getAutoRecharge",
        args: { "customerRef" => "{customerRef}" },
        requires: :stripe,
        skip_reason: "requires: stripe",
      ),
      Scenario.new(
        id: "saveAutoRecharge",
        op: "saveAutoRecharge",
        args: {
          "customerRef" => "{customerRef}",
          "enabled" => true,
          "threshold" => 100,
          "topupAmount" => 500,
        },
        requires: :stripe,
        skip_reason: "requires: stripe",
      ),
      Scenario.new(
        id: "disableAutoRecharge",
        op: "disableAutoRecharge",
        args: { "customerRef" => "{customerRef}" },
        requires: :stripe,
        skip_reason: "requires: stripe",
      ),
      Scenario.new(
        id: "getProduct-bogus",
        op: "getProduct",
        args: { "productRef" => "prd_shadow_does_not_exist_zzzz" },
        expect_error: true,
      ),
      Scenario.new(
        id: "getCustomer-bogus",
        op: "getCustomer",
        args: { "customerRef" => "cus_shadow_does_not_exist_zzzz" },
        expect_error: true,
      ),
      Scenario.new(
        id: "deletePlan",
        op: "deletePlan",
        args: { "productRef" => "{productRef}", "planRef" => "{planRef}" },
      ),
      Scenario.new(
        id: "deleteProduct",
        op: "deleteProduct",
        args: { "productRef" => "{productRef}" },
      ),
    ].freeze

    VOLATILE_KEYS = %w[
      id
      reference
      createdAt
      updatedAt
      created
      updated
      idempotencyKey
      clientSecret
      secret
      token
      url
      checkoutUrl
      sessionUrl
    ].freeze
    VOLATILE_SUFFIXES = %w[At Url Ref Id Secret Token].freeze

    def camel_to_snake(value)
      out = +""
      value.each_char.with_index do |char, index|
        if char.match?(/[A-Z]/) && index.positive?
          prev = value[index - 1]
          out << "_" if prev.match?(/[a-z0-9]/)
        end
        out << char.downcase
      end
      out
    end

    def snake_to_camel(value)
      value.to_s.split("_").each_with_index.map do |part, index|
        index.zero? ? part : part.capitalize
      end.join
    end

    def resolve_args(template, refs)
      walk = lambda do |value|
        case value
        when String
          out = value
          refs.each { |key, replacement| out = out.gsub("{#{key}}", replacement) }
          out
        when Array
          value.map { |item| walk.call(item) }
        when Hash
          value.transform_values { |child| walk.call(child) }
        else
          value
        end
      end
      walk.call(template)
    end

    def extract_ref(value, keys)
      return nil unless value.is_a?(Hash)

      keys.each do |key|
        candidate = value[key]
        return candidate if candidate.is_a?(String) && !candidate.empty?
      end
      %w[product plan customer].each do |nest|
        found = extract_ref(value[nest], keys)
        return found if found
      end
      nil
    end

    def normalize(value)
      case value
      when Array
        value.map { |item| normalize(item) }
      when Hash
        out = {}
        value.each do |key, child|
          key_s = key.to_s
          next if VOLATILE_KEYS.include?(key_s)
          next if VOLATILE_SUFFIXES.any? { |suffix| key_s.end_with?(suffix) }
          next if child.nil?

          out[key_s] = normalize(child)
        end
        out
      else
        value
      end
    end

    # Map camelCase scenario args onto the generated keyword Client API.
    def build_kwargs(client, snake, args)
      meth = client.method(snake)
      remaining = args.transform_keys(&:to_s).dup
      kwargs = {}
      param_names = meth.parameters.filter_map { |kind, name| name if %i[key keyreq].include?(kind) }

      param_names.each do |name|
        next if name == :params || name == :overrides

        camel = snake_to_camel(name)
        if remaining.key?(camel)
          kwargs[name] = remaining.delete(camel)
        elsif remaining.key?(name.to_s)
          kwargs[name] = remaining.delete(name.to_s)
        end
      end

      if param_names.include?(:params)
        kwargs[:params] = remaining.key?("params") ? remaining.delete("params") : remaining.dup
        remaining.clear
      elsif param_names.include?(:overrides) && !remaining.empty?
        kwargs[:overrides] = remaining.dup
        remaining.clear
      end

      kwargs
    end

    def invoke(client, op, args)
      snake = camel_to_snake(op)
      kwargs = build_kwargs(client, snake, args)
      begin
        value = client.public_send(snake, **kwargs)
        { "ok" => true, "value" => value }
      rescue SolvaPayError, PaywallError => e
        {
          "ok" => false,
          "error" => {
            "name" => e.class.name.split("::").last,
            "message" => e.message,
            "status" => e.status,
            "code" => e.code,
          },
        }
      end
    end

    def structured_error?(outcome)
      return false unless outcome["ok"] == false

      error = outcome["error"]
      return false unless error.is_a?(Hash)

      message = error["message"]
      message.is_a?(String) && !message.empty?
    end

    def score_scenario(scenario, outcome)
      if scenario.expect_error
        return structured_error?(outcome) ? "IDENTICAL" : "DIVERGED"
      end

      outcome["ok"] == true ? "IDENTICAL" : "DIVERGED"
    end

    def setup_side(client, run_id)
      side_tag = "rb-#{run_id}"
      email = "shadow-#{side_tag}@example.com"

      product = invoke(
        client,
        "createProduct",
        { "name" => "Shadow Product #{side_tag}", "config" => {}, "metadata" => {} },
      )
      raise "setup createProduct failed: #{product}" unless product["ok"]

      product_ref = extract_ref(product["value"], %w[reference productRef])
      raise "setup missing productRef: #{product}" if product_ref.nil?

      plan = invoke(
        client,
        "createPlan",
        {
          "productRef" => product_ref,
          "name" => "Shadow Plan #{side_tag}",
          "type" => "recurring",
          "billingCycle" => "monthly",
          "price" => 1000,
          "currency" => "usd",
        },
      )
      raise "setup createPlan failed: #{plan}" unless plan["ok"]

      plan_ref = extract_ref(plan["value"], %w[reference planRef])
      raise "setup missing planRef: #{plan}" if plan_ref.nil?

      customer = invoke(client, "createCustomer", { "email" => email })
      raise "setup createCustomer failed: #{customer}" unless customer["ok"]

      customer_ref = extract_ref(customer["value"], %w[customerRef reference])
      raise "setup missing customerRef: #{customer}" if customer_ref.nil?

      {
        "productRef" => product_ref,
        "planRef" => plan_ref,
        "customerRef" => customer_ref,
        "email" => email,
        "sideTag" => side_tag,
        "purchaseRef" => "pur_missing_shadow",
        "paymentIntentId" => "pi_missing_shadow",
      }
    end

    def capture_refs!(refs, scenario, outcome)
      return unless outcome["ok"] == true && outcome["value"].is_a?(Hash)

      case scenario.op
      when "createProduct"
        ref = extract_ref(outcome["value"], %w[reference productRef])
        refs["productRef"] = ref if ref
      when "createPlan"
        ref = extract_ref(outcome["value"], %w[reference planRef])
        refs["planRef"] = ref if ref
      when "createCustomer"
        ref = extract_ref(outcome["value"], %w[customerRef reference])
        refs["customerRef"] = ref if ref
      end
    end

    def main
      base_url = ENV["SOLVAPAY_SHADOW_BASE_URL"]
      api_key = ENV["SOLVAPAY_SHADOW_API_KEY"]
      if base_url.nil? || base_url.empty? || api_key.nil? || api_key.empty?
        warn "SOLVAPAY_SHADOW_BASE_URL and SOLVAPAY_SHADOW_API_KEY are required"
        return 2
      end

      enable_stripe = %w[1 true yes].include?(ENV.fetch("SOLVAPAY_SHADOW_ENABLE_STRIPE", "").downcase)
      out_path = ENV.fetch("SOLVAPAY_LIVE_OUT", DEFAULT_OUT)
      FileUtils.mkdir_p(File.dirname(out_path))

      started = Time.now.utc.strftime("%Y-%m-%dT%H:%M:%SZ")
      client = Client.new(api_key: api_key, api_base_url: base_url)
      run_id = SecureRandom.hex(4)
      refs = setup_side(client, run_id)

      results = []
      failures = 0
      SCENARIOS.each do |scenario|
        if scenario.requires == :stripe && !enable_stripe
          results << {
            "op" => scenario.op,
            "scenarioId" => scenario.id,
            "status" => "SKIPPED",
            "reason" => scenario.skip_reason || "requires: stripe",
          }
          next
        end
        if scenario.requires == :active_purchase
          results << {
            "op" => scenario.op,
            "scenarioId" => scenario.id,
            "status" => "SKIPPED",
            "reason" => scenario.skip_reason || "requires: activePurchase",
          }
          next
        end

        args = resolve_args(scenario.args, refs)
        begin
          outcome = invoke(client, scenario.op, args)
        rescue StandardError => e
          failures += 1
          results << {
            "op" => scenario.op,
            "scenarioId" => scenario.id,
            "status" => "ERROR",
            "error" => e.message,
          }
          next
        end

        status = score_scenario(scenario, outcome)
        failures += 1 if status == "DIVERGED"
        results << {
          "op" => scenario.op,
          "scenarioId" => scenario.id,
          "status" => status,
          "normalized" => normalize(outcome),
        }
        capture_refs!(refs, scenario, outcome)
      end

      finished = Time.now.utc.strftime("%Y-%m-%dT%H:%M:%SZ")
      report = {
        "startedAt" => started,
        "finishedAt" => finished,
        "baseUrl" => base_url,
        "mode" => "live",
        "side" => "ruby",
        "results" => results,
      }
      File.write(out_path, "#{JSON.pretty_generate(report)}\n")

      identical = results.count { |r| r["status"] == "IDENTICAL" }
      skipped = results.count { |r| r["status"] == "SKIPPED" }
      puts "ruby live contract: identical=#{identical} skipped=#{skipped} " \
           "failed=#{failures} report=#{out_path}"
      failures.positive? ? 1 : 0
    end
  end
end

if __FILE__ == $PROGRAM_NAME
  exit SolvaPay::LiveContract.main
end
