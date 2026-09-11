# frozen_string_literal: true

module BitcoinAnalytics
  module Format
    SATS_PER_BTC = 100_000_000
    MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1_000
    EPOCH_YEAR_MIN = 2020
    EPOCH_YEAR_MAX = 2035

    module_function

    def amount(sats)
      "#{btc_from_sats(sats)} (#{group_int(sats)} sat)"
    end

    def btc_from_sats(sats)
      whole, remainder = Integer(sats).divmod(SATS_PER_BTC)
      "#{group_int(whole)}.#{remainder.to_s.rjust(8, "0")} BTC"
    end

    def reward_btc(btc)
      sats = (Float(btc) * SATS_PER_BTC).round
      btc_from_sats(sats)
    end

    def fee_rate(rate)
      value = Float(rate)
      decimals = value < 1 ? 3 : 2
      "#{trim_zeros(format("%0.#{decimals}f", value))} sat/vB"
    end

    def percent(value)
      "#{trim_zeros(format("%.2f", Float(value)))}%"
    end

    def signed_percent(value)
      value = Float(value)
      sign = value.positive? ? "+" : ""
      "#{sign}#{format("%.2f", value)}%"
    end

    def duration_ms(ms)
      assert_duration_ms!(ms)
      seconds = Integer(ms) / 1_000
      return "0 seconds" if seconds.zero?

      units = []
      days, rem = seconds.divmod(86_400)
      hours, rem = rem.divmod(3_600)
      minutes, secs = rem.divmod(60)
      units << [days, "day"] if days.positive?
      units << [hours, "hour"] if hours.positive?
      units << [minutes, "minute"] if minutes.positive?
      units << [secs, "second"] if secs.positive?
      units.first(2).map { |n, name| "#{n} #{name}#{n == 1 ? "" : "s"}" }.join(", ")
    end

    def epoch_ms(ms)
      assert_epoch_ms!(ms)
      Time.at(Integer(ms) / 1_000.0).utc.strftime("%Y-%m-%dT%H:%M:%SZ")
    end

    def epoch_seconds(seconds)
      assert_epoch_seconds!(seconds)
      Time.at(Integer(seconds)).utc.strftime("%Y-%m-%dT%H:%M:%SZ")
    end

    def difficulty(raw)
      value = Float(raw)
      scale = [
        [1_000_000_000_000.0, "T"],
        [1_000_000_000.0, "G"],
        [1_000_000.0, "M"],
        [1_000.0, "K"],
      ].find { |divisor, _| value >= divisor }
      return value.to_s if scale.nil?

      divisor, suffix = scale
      "#{format("%.2f", value / divisor)} #{suffix}"
    end

    def vbytes(value)
      "#{format("%.2f", Integer(value) / 1_000_000.0)} MvB"
    end

    def megabytes(value)
      formatted = value.is_a?(String) ? value : format("%.2f", Float(value))
      "#{formatted} MB"
    end

    def count(value)
      group_int(value)
    end

    def signed_delta(value)
      value = Integer(value)
      return "0" if value.zero?

      "#{value.positive? ? "+" : "-"}#{group_int(value.abs)}"
    end

    def display(value)
      return "not reported" if value.nil?

      value.to_s
    end

    def assert_duration_ms!(value)
      ms = Integer(value)
      return if ms >= 0 && ms <= MAX_DURATION_MS

      raise ArgumentError, "duration_ms out of range: #{value} (expected 0..~30 days in milliseconds)"
    end

    def assert_epoch_ms!(value)
      assert_epoch_year!(Integer(value) / 1_000, "epoch_ms")
    end

    def assert_epoch_seconds!(value)
      assert_epoch_year!(Integer(value), "epoch_seconds")
    end

    def assert_epoch_year!(seconds, label)
      year = Time.at(seconds).utc.year
      return if year.between?(EPOCH_YEAR_MIN, EPOCH_YEAR_MAX)

      raise ArgumentError, "#{label} out of range: year #{year}"
    end

    def group_int(value)
      Integer(value).to_s.gsub(/(\d)(?=(\d{3})+(?!\d))/, "\\1,")
    end

    def trim_zeros(formatted)
      formatted.sub(/\.0+$/, "").sub(/(\.\d*?)0+$/, "\\1")
    end
  end
end
