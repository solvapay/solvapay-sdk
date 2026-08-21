# frozen_string_literal: true

require "minitest/autorun"
require_relative "../scripts/live_contract"

# Step 45 — pure helpers from the live contract driver (stdlib, offline).
class LiveContractTest < Minitest::Test
  include SolvaPay::LiveContract

  def test_camel_to_snake
    assert_equal "create_product", camel_to_snake("createProduct")
    assert_equal "get_merchant", camel_to_snake("getMerchant")
    assert_equal "bootstrap_mcp_product", camel_to_snake("bootstrapMcpProduct")
  end

  def test_resolve_args_recursive
    refs = {
      "productRef" => "prd_1",
      "sideTag" => "rb-abc",
      "customerRef" => "cus_1",
    }
    template = {
      "productRef" => "{productRef}",
      "name" => "Shadow Product {sideTag}",
      "events" => [
        { "customerRef" => "{customerRef}", "units" => 1 },
      ],
      "nested" => { "productRef" => "{productRef}" },
    }
    resolved = resolve_args(template, refs)
    assert_equal "prd_1", resolved["productRef"]
    assert_equal "Shadow Product rb-abc", resolved["name"]
    assert_equal "cus_1", resolved["events"][0]["customerRef"]
    assert_equal "prd_1", resolved["nested"]["productRef"]
  end

  def test_normalize_strips_volatile_keys_and_nils
    raw = {
      "ok" => true,
      "value" => {
        "displayName" => "Acme",
        "id" => "x",
        "reference" => "prd_1",
        "createdAt" => "2026-01-01",
        "checkoutUrl" => "https://example/checkout",
        "clientSecret" => "secret",
        "nullable" => nil,
        "nested" => {
          "productRef" => "prd_1",
          "name" => "Keep",
          "token" => "t",
        },
      },
    }
    normalized = normalize(raw)
    assert_equal true, normalized["ok"]
    assert_equal "Acme", normalized["value"]["displayName"]
    refute normalized["value"].key?("id")
    refute normalized["value"].key?("reference")
    refute normalized["value"].key?("createdAt")
    refute normalized["value"].key?("checkoutUrl")
    refute normalized["value"].key?("clientSecret")
    refute normalized["value"].key?("nullable")
    assert_equal({ "name" => "Keep" }, normalized["value"]["nested"])
  end

  def test_score_scenario_expect_error_structured
    scenario = Scenario.new(
      id: "cloneProduct",
      op: "cloneProduct",
      args: {},
      expect_error: true,
    )
    outcome = {
      "ok" => false,
      "error" => {
        "name" => "SolvaPayError",
        "message" => "providerId required",
        "status" => 500,
        "code" => "internal",
      },
    }
    assert_equal "IDENTICAL", score_scenario(scenario, outcome)
  end

  def test_score_scenario_success_path_ok_false_diverged
    scenario = Scenario.new(
      id: "getMerchant",
      op: "getMerchant",
      args: {},
    )
    outcome = {
      "ok" => false,
      "error" => {
        "name" => "SolvaPayError",
        "message" => "unauthorized",
        "status" => 401,
        "code" => "unauthorized",
      },
    }
    assert_equal "DIVERGED", score_scenario(scenario, outcome)
  end

  def test_score_scenario_success_path_ok_identical
    scenario = Scenario.new(
      id: "getMerchant",
      op: "getMerchant",
      args: {},
    )
    assert_equal "IDENTICAL", score_scenario(scenario, { "ok" => true, "value" => {} })
  end
end
