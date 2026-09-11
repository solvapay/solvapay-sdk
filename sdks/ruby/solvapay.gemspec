# frozen_string_literal: true

require_relative "lib/solvapay/version"

Gem::Specification.new do |spec|
  spec.name = "solvapay"
  spec.version = SolvaPay::VERSION
  spec.authors = ["SolvaPay"]
  spec.email = ["support@solvapay.com"]

  spec.summary = "SolvaPay Ruby SDK (Magnus / rb-sys binding over Rust core)"
  spec.description = "Native Ruby binding for the SolvaPay Rust core SDK (Step 43 scaffold)."
  spec.homepage = "https://github.com/solvapay/solvapay-sdk"
  spec.license = "MIT"
  spec.required_ruby_version = ">= 3.0.0"

  spec.metadata["homepage_uri"] = spec.homepage
  spec.metadata["source_code_uri"] = spec.homepage

  spec.files = Dir.chdir(__dir__) do
    Dir[
      "lib/**/*.rb",
      "sig/**/*.rbs",
      "ext/**/*",
      "test/**/*",
      "scripts/**/*",
      "Gemfile",
      "Rakefile",
      "solvapay.gemspec",
      "README.md",
      ".gitignore",
    ].select { |f| File.file?(f) && !f.end_with?(".bundle", ".so", ".dll") }
  end

  spec.bindir = "exe"
  spec.require_paths = ["lib"]
  spec.extensions = ["ext/solvapay/extconf.rb"]

  spec.add_dependency "rb_sys", "~> 0.9"

  spec.add_development_dependency "minitest", "~> 5.0"
  spec.add_development_dependency "rake", "~> 13.0"
  spec.add_development_dependency "rake-compiler", "~> 1.2"
  spec.add_development_dependency "rb_sys", "~> 0.9"
  # Step 45T — exact pins also listed in Gemfile `:typecheck` group.
  # steep 2.0 requires rbs ~> 4.0 (bumped from ~> 3.0).
  spec.add_development_dependency "rbs", "= 4.0.3"
  spec.add_development_dependency "steep", "= 2.0.0"
  spec.add_development_dependency "rubocop", "= 1.88.2"
end


