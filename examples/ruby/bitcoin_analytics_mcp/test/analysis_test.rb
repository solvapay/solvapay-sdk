# frozen_string_literal: true

require "minitest/autorun"
require "time"
require_relative "../analysis"

class AnalysisTest < Minitest::Test
  def test_height_delta_is_signed
    snap = BitcoinAnalytics::Analysis.network_snapshot(
      btcnode_info: { "chain" => "main", "blocks" => 964_840, "difficulty" => "125807076547197.5", "connections" => 12 },
      mempool_height: 964_846,
      mempool_hash: "abc",
      difficulty_adjustment: difficulty_adjustment,
      halving: era_halving(964_846),
    )
    assert_equal 6, snap.fetch("heightDelta")
    assert_equal 964_846, snap.fetch("mempoolTipHeight")
    assert_equal 964_840, snap.fetch("btcnodeTipHeight")
    assert_equal "125807076547197.5", snap.fetch("difficultyRaw")
    assert_equal 5, snap.fetch("era")
    assert_equal 3.125, snap.fetch("rewardBtc")
  end

  def test_network_snapshot_keeps_fetched_fields_when_a_source_is_missing
    snap = BitcoinAnalytics::Analysis.network_snapshot(
      btcnode_info: nil,
      mempool_height: 964_846,
      mempool_hash: "abc",
      difficulty_adjustment: difficulty_adjustment,
      halving: era_halving(964_846),
    )
    assert_equal 964_846, snap.fetch("mempoolTipHeight")
    assert_nil snap.fetch("btcnodeTipHeight")
    assert_nil snap.fetch("heightDelta")
    assert_nil snap.fetch("difficultyRaw")
    assert_equal 5, snap.fetch("era")
  end

  def test_era_progress_is_blocks_into_era_over_210000
    outlook = BitcoinAnalytics::Analysis.halving_outlook(
      tip_height: 964_846,
      halving: era_halving(964_846).merge("blocksIntoEra" => 105_000),
    )
    assert_in_delta 105_000 / 210_000.0, outlook.fetch("eraProgress"), 1e-12
    assert_equal 210_000, outlook.fetch("eraLengthBlocks")
    assert_equal 600, outlook.fetch("estimatedSecondsToHalving")
  end

  def test_halving_boundaries_and_zero_subsidy
    era5 = BitcoinAnalytics::Analysis.halving_outlook(
      tip_height: 1_049_999,
      halving: {
        "era" => 5,
        "rewardBtc" => 3.125,
        "blocksIntoEra" => 209_999,
        "blocksUntilNextHalving" => 1,
        "nextHalvingBlock" => 1_050_000,
      },
    )
    assert_equal 5, era5.fetch("era")
    assert_equal 1, era5.fetch("blocksUntilNextHalving")

    era6 = BitcoinAnalytics::Analysis.halving_outlook(
      tip_height: 1_050_000,
      halving: {
        "era" => 6,
        "rewardBtc" => 1.5625,
        "blocksIntoEra" => 0,
        "blocksUntilNextHalving" => 210_000,
        "nextHalvingBlock" => 1_260_000,
      },
    )
    assert_equal 6, era6.fetch("era")
    assert_equal 1.5625, era6.fetch("rewardBtc")

    ended = BitcoinAnalytics::Analysis.halving_outlook(
      tip_height: 6_930_000,
      halving: {
        "era" => 34,
        "rewardBtc" => 0,
        "blocksIntoEra" => 0,
        "blocksUntilNextHalving" => 210_000,
        "nextHalvingBlock" => 7_140_000,
      },
    )
    assert_equal 0, ended.fetch("rewardBtc")
    assert_equal 34, ended.fetch("era")
    assert ended.fetch("issuanceEnded")
  end

  def test_fee_outlook_joins_sources_and_keeps_sub_one
    outlook = BitcoinAnalytics::Analysis.fee_outlook(
      recommended: { "fastestFee" => 1, "halfHourFee" => 1, "hourFee" => 1, "economyFee" => 1, "minimumFee" => 1 },
      precise: { "fastestFee" => 0.8, "halfHourFee" => 0.5, "hourFee" => 0.4, "economyFee" => 0.2, "minimumFee" => 0.1 },
      mempool_blocks: [{ "totalFees" => 518_964, "medianFee" => 0.373, "nTx" => 3_000, "blockVSize" => 998_000.0 }],
      btcnode_fees: { "high" => 2, "medium" => 1, "low" => 1, "unit" => "sat/vB" },
      predict: {
        "current" => { "high" => 2, "medium" => 1, "low" => 1 },
        "next_3_blocks" => { "block_1" => 1, "block_2" => 1, "block_3" => 1 },
      },
    )
    assert_equal 0.8, outlook.fetch("preciseFastestFeeSatsPerVb")
    assert_equal 1, outlook.fetch("recommendedFastestFeeSatsPerVb")
    assert_equal 0.373, outlook.fetch("nextBlockMedianFeeSatsPerVb")
    assert_equal 518_964, outlook.fetch("nextBlockFeeSats")
    assert_equal 2, outlook.fetch("btcnodeHighSatsPerVb")
    assert_equal 1, outlook.fetch("predictBlock1SatsPerVb")
    assert(outlook.fetch("notes").any? { |note| note.include?("floors at 1") })
  end

  def test_mempool_health_delta_is_count_only
    health = BitcoinAnalytics::Analysis.mempool_health(
      mempool: { "count" => 79_550, "vsize" => 40_294_934, "total_fee" => 1_000_000 },
      recent: [{ "txid" => "aa", "fee" => 250, "vsize" => 200, "value" => 50_000 }],
      btcnode_mempool: { "pending_tx" => 23_457, "mempool_mb" => "7.29" },
    )
    assert_equal 56_093, health.fetch("pendingTxDelta")
    assert_equal 79_550, health.fetch("mempoolPendingTx")
    assert_equal 23_457, health.fetch("btcnodePendingTx")
    assert_equal 40_294_934, health.fetch("mempoolVsize")
    assert_equal "7.29", health.fetch("btcnodeMempoolMb")
    refute health.key?("sizeDelta")
    refute health.key?("vsizeMinusMb")
    assert(health.fetch("notes").any? { |note| note.include?("not the same measure") })
    assert_equal 250, health.fetch("recent").first.fetch("feeSats")
  end

  def test_address_brief_from_chain_stats
    brief = BitcoinAnalytics::Analysis.address_brief(
      address: {
        "chain_stats" => {
          "funded_txo_count" => 4,
          "funded_txo_sum" => 15_007_688_098,
          "spent_txo_count" => 1,
          "spent_txo_sum" => 100_000,
          "tx_count" => 5,
        },
        "mempool_stats" => {
          "funded_txo_count" => 1,
          "funded_txo_sum" => 50_000,
          "spent_txo_count" => 0,
          "spent_txo_sum" => 0,
          "tx_count" => 1,
        },
      },
    )
    assert_equal 15_007_588_098, brief.fetch("confirmedBalanceSats")
    assert_equal 50_000, brief.fetch("mempoolDeltaSats")
    assert_equal 3, brief.fetch("utxoCount")
    assert_equal 5, brief.fetch("txCount")
  end

  def test_tx_brief_derives_vsize_and_cross_checks_confirmations
    brief = BitcoinAnalytics::Analysis.tx_brief(
      tx: { "fee" => 1_000, "size" => 250, "weight" => 1_000, "txid" => "deadbeef" },
      status: {
        "confirmed" => true,
        "block_height" => 363_348,
        "block_hash" => "00aa",
        "block_time" => 1_787_446_127,
      },
      tip_height: 964_846,
      btcnode_tx: { "confirmations" => 601_499, "block_height" => nil },
      trace: {
        "inputs" => [
          { "value" => 6.8686, "funding_sources" => [{ "value" => 1.0 }] },
        ],
      },
    )
    assert_in_delta 250.0, brief.fetch("vsize"), 1e-9
    assert_in_delta 4.0, brief.fetch("feeRateSatsPerVb"), 1e-9
    assert_equal 601_499, brief.fetch("derivedConfirmations")
    assert_equal 601_499, brief.fetch("btcnodeConfirmations")
    assert_nil brief.fetch("btcnodeBlockHeight")
    refute_equal 0, brief.fetch("btcnodeBlockHeight") unless brief.fetch("btcnodeBlockHeight").nil?
    assert_equal 686_860_000, brief.fetch("trace").fetch("inputs").first.fetch("valueSats")
  end

  def test_miner_revenue_split
    split = BitcoinAnalytics::Analysis.miner_revenue_split(
      tip_height: 964_846,
      halving: { "era" => 5, "rewardBtc" => 3.125 },
      mempool_blocks: [{ "totalFees" => 518_964, "medianFee" => 0.373 }],
    )
    assert_equal 312_500_000, split.fetch("subsidySats")
    assert_equal 518_964, split.fetch("nextBlockFeeSats")
    assert_equal 313_018_964, split.fetch("totalRewardSats")
    assert_in_delta 0.1658, split.fetch("feeShareOfRewardPercent"), 0.0001
  end

  def test_missing_required_key_raises
    error = assert_raises(KeyError) do
      BitcoinAnalytics::Analysis.network_snapshot(
        btcnode_info: { "chain" => "main" },
        mempool_height: 1,
        mempool_hash: "aa",
        difficulty_adjustment: difficulty_adjustment,
        halving: era_halving(1),
      )
    end
    assert_includes error.message, "blocks"
  end

  private

  def difficulty_adjustment
    {
      "progressPercent" => 59.42,
      "difficultyChange" => 0.42871362181344796,
      "previousRetarget" => -1.31,
      "remainingBlocks" => 818,
      "remainingTime" => 489_112_466,
      "timeAvg" => 597_937,
      "estimatedRetargetDate" => 1_788_651_568_466,
      "previousTime" => 1_787_446_127,
      "nextRetargetHeight" => 965_664,
    }
  end

  def era_halving(height)
    {
      "era" => 5,
      "rewardBtc" => 3.125,
      "blocksIntoEra" => height % 210_000,
      "blocksUntilNextHalving" => 1,
      "nextHalvingBlock" => 1_050_000,
    }
  end
end
