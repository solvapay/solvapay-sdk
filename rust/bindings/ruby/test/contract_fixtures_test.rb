# frozen_string_literal: true

require "minitest/autorun"
require "solvapay"
require_relative "contract"

class ContractFixturesTest < Minitest::Test
  REPO_ROOT = Contract::FixtureLoader.repo_root(__dir__)
  FIXTURES_ROOT = REPO_ROOT.join("contract", "fixtures")
  FIXTURE_FILES = Contract::FixtureLoader.discover(FIXTURES_ROOT).freeze

  def test_covers_every_manifest_client_operation_with_success_and_error
    manifest = File.read(
      REPO_ROOT.join("contract", "manifest", "sdk-contract.yaml"),
      encoding: "UTF-8",
    )
    block = manifest.match(/^operations:\n(.*?)(?=^\S|\z)/m)&.captures&.first
    refute_nil block, "manifest missing operations"
    names = block.scan(/^    names:\n      ts:\s*(\S+)\s*$/).flatten
    assert_equal 36, names.length

    relative = FIXTURE_FILES.map { |path| Pathname(path).relative_path_from(FIXTURES_ROOT).to_s }
    missing = names.filter_map do |name|
      directory = Contract::Names.camel_to_kebab(name)
      stems = relative
              .select { |path| path.start_with?("client/#{directory}/") }
              .map { |path| File.basename(path, ".json") }
      success = stems.any? { |stem| Contract::Names.success_case?(stem) }
      error = stems.any? { |stem| Contract::Names.error_case?(stem) }
      "#{name}: success=#{success} error=#{error} files=#{stems.inspect}" unless success && error
    end
    assert_empty missing, missing.join("\n")
  end

  FIXTURE_FILES.each_with_index do |path, index|
    relative = Pathname(path).relative_path_from(FIXTURES_ROOT).to_s
    test_name = relative.gsub(/[^a-zA-Z0-9]+/, "_")
    define_method("test_fixture_#{index}_#{test_name}") do
      fixture = Contract::FixtureLoader.load(path)
      outcome = Contract::Dispatch.replay(fixture, test: self)
      Contract::Compare.assert_expect(self, outcome, fixture)
    end
  end
end
