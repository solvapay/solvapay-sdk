# frozen_string_literal: true

require "pathname"
require "yaml"

module McpAuthoring
  module RepoPaths
    module_function

    def lookup_mcp_fixtures
      here = Pathname.new(__dir__).expand_path
      here.ascend do |parent|
        manifest = parent.join("contract", "manifest", "repo-paths.yaml")
        next unless manifest.file?

        loaded = YAML.safe_load(manifest.read)
        raise "repo-paths.yaml is not a mapping" unless loaded.is_a?(Hash)

        lookups = loaded["lookups"]
        unless lookups.is_a?(Hash) && lookups.key?("mcpFixtures")
          raise "lookups.mcpFixtures is missing from repo-paths.yaml"
        end

        rel = lookups["mcpFixtures"]
        raise "lookups.mcpFixtures must be a non-empty string" unless rel.is_a?(String) && !rel.empty?

        return parent.join(rel)
      end
      raise "could not locate contract/manifest/repo-paths.yaml"
    end
  end
end
