# frozen_string_literal: true

require "minitest/autorun"
require_relative "../format"

class FormatTest < Minitest::Test
  def test_btc_from_sats_uses_integer_arithmetic
    assert_equal(
      "150.07688098 BTC (15,007,688,098 sat)",
      BitcoinAnalytics::Format.amount(15_007_688_098),
    )
  end

  def test_zero_sats_and_zero_reward_btc
    assert_equal "0.00000000 BTC (0 sat)", BitcoinAnalytics::Format.amount(0)
    assert_equal "0.00000000 BTC", BitcoinAnalytics::Format.reward_btc(0)
    refute_empty BitcoinAnalytics::Format.reward_btc(0)
  end

  def test_fee_rate_preserves_sub_one_and_strips_trailing_zeros
    assert_equal "0.373 sat/vB", BitcoinAnalytics::Format.fee_rate(0.3734290843806104)
    assert_equal "2 sat/vB", BitcoinAnalytics::Format.fee_rate(2)
  end

  def test_signed_percent
    assert_equal "+0.43%", BitcoinAnalytics::Format.signed_percent(0.42871362181344796)
    assert_equal "-1.31%", BitcoinAnalytics::Format.signed_percent(-1.31)
  end

  def test_percent_two_decimals
    assert_equal "0.17%", BitcoinAnalytics::Format.percent(0.1658)
  end

  def test_duration_ms_uses_two_largest_units
    assert_equal "5 days, 15 hours", BitcoinAnalytics::Format.duration_ms(489_112_466)
  end

  def test_epoch_ms_and_epoch_seconds_use_correct_bases
    assert_equal "2026-09-05T23:39:28Z", BitcoinAnalytics::Format.epoch_ms(1_788_651_568_466)
    assert_equal "2026-08-23T00:48:47Z", BitcoinAnalytics::Format.epoch_seconds(1_787_446_127)
  end

  def test_difficulty_si_scale_preserves_raw
    assert_equal "125.81 T", BitcoinAnalytics::Format.difficulty("125807076547197.5")
  end

  def test_sizes_use_distinct_suffixes
    assert_equal "40.29 MvB", BitcoinAnalytics::Format.vbytes(40_294_934)
    assert_equal "7.29 MB", BitcoinAnalytics::Format.megabytes("7.29")
  end

  def test_counts_and_signed_deltas
    assert_equal "964,846", BitcoinAnalytics::Format.count(964_846)
    assert_equal "+12", BitcoinAnalytics::Format.signed_delta(12)
    assert_equal "-3", BitcoinAnalytics::Format.signed_delta(-3)
    assert_equal "0", BitcoinAnalytics::Format.signed_delta(0)
  end

  def test_nil_display_is_not_reported
    assert_equal "not reported", BitcoinAnalytics::Format.display(nil)
  end

  def test_assert_duration_ms_rejects_out_of_range
    err = assert_raises(ArgumentError) { BitcoinAnalytics::Format.assert_duration_ms!(-1) }
    assert_includes err.message, "duration"
    too_long = (31 * 24 * 60 * 60 * 1_000)
    assert_raises(ArgumentError) { BitcoinAnalytics::Format.assert_duration_ms!(too_long) }
    BitcoinAnalytics::Format.assert_duration_ms!(489_112_466)
  end

  def test_assert_epoch_ms_rejects_seconds_scale_values
    err = assert_raises(ArgumentError) { BitcoinAnalytics::Format.assert_epoch_ms!(1_787_446_127) }
    assert_includes err.message, "epoch"
    BitcoinAnalytics::Format.assert_epoch_ms!(1_788_651_568_466)
  end

  def test_assert_epoch_seconds_rejects_millisecond_scale_values
    err = assert_raises(ArgumentError) { BitcoinAnalytics::Format.assert_epoch_seconds!(1_788_651_568_466) }
    assert_includes err.message, "epoch"
    BitcoinAnalytics::Format.assert_epoch_seconds!(1_787_446_127)
  end
end
