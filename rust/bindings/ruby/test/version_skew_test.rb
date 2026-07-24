# frozen_string_literal: true

require "minitest/autorun"
require "solvapay"

# Step 45 — load-time facade ↔ native version skew guard (§7.7).
class VersionSkewTest < Minitest::Test
  def test_native_version_matches_gem
    assert_equal SolvaPay::VERSION, SolvaPay.version
    assert_equal "0.1.0", SolvaPay.version
    info = SolvaPay.native_build_info
    assert_includes info, '"version":"0.1.0"'
  end

  def test_skew_raises
    original = SolvaPay.method(:version)
    SolvaPay.define_singleton_method(:version) { "9.9.9" }
    begin
      err = assert_raises(SolvaPay::SolvaPayError) { SolvaPay._check_version_skew }
      assert_equal "version_skew", err.code
    ensure
      SolvaPay.define_singleton_method(:version) { original.call }
    end
  end

  def test_matching_versions_pass
    SolvaPay._check_version_skew
  end
end
