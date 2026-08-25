# frozen_string_literal: true

require_relative "lib/solvapay/mcp/version"

Gem::Specification.new do |spec|
  spec.name = "solvapay-mcp"
  spec.version = SolvaPay::Mcp::VERSION
  spec.authors = ["SolvaPay"]
  spec.email = ["support@solvapay.com"]

  spec.summary = "SolvaPay payable-MCP adapter for the official mcp gem"
  spec.description = "Hand-written registerPayable / ctx.respond adapter over MCP::Server."
  spec.homepage = "https://github.com/solvapay/solvapay-sdk"
  spec.license = "MIT"
  spec.required_ruby_version = ">= 3.0.0"

  spec.metadata["homepage_uri"] = spec.homepage
  spec.metadata["source_code_uri"] = spec.homepage

  spec.files = Dir.chdir(__dir__) do
    Dir[
      "lib/**/*.rb",
      "sig/**/*.rbs",
      "test/**/*",
      "Gemfile",
      "Rakefile",
      "solvapay-mcp.gemspec",
      "README.md",
      ".gitignore",
    ].select { |f| File.file?(f) }
  end

  spec.require_paths = ["lib"]

  spec.add_dependency "solvapay", ">= 0.1.0"
  spec.add_dependency "mcp", "~> 1.3"
end
