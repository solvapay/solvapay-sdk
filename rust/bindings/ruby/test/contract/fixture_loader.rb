# frozen_string_literal: true

require "json"
require "pathname"

module Contract
  module FixtureLoader
    module_function

    def repo_root(start = __dir__)
      current = Pathname(start).expand_path
      current = current.dirname if current.file?
      loop do
        return current if current.join("contract", "fixtures").directory?
        raise "could not locate repo root containing contract/fixtures" if current.root?

        current = current.parent
      end
    end

    def discover(root)
      Dir[root.join("**", "*.json").to_s].sort
    end

    def load(path)
      fixture = JSON.parse(File.read(path, encoding: "UTF-8"))
      validate!(fixture, path)
      fixture["_path"] = path
      fixture
    end

    def validate!(fixture, path)
      raise "#{path}: fixture root must be an object" unless fixture.is_a?(Hash)
      %w[suite case input expect].each do |key|
        raise "#{path}: missing #{key}" unless fixture.key?(key)
      end
      input = fixture["input"]
      raise "#{path}: input must be an object" unless input.is_a?(Hash)
      raise "#{path}: input.fn must be a string" unless input["fn"].is_a?(String)
      input["args"] ||= {}
      raise "#{path}: input.args must be an object" unless input["args"].is_a?(Hash)
      expect = fixture["expect"]
      raise "#{path}: expect must be an object" unless expect.is_a?(Hash)
      unless expect.key?("result") ^ expect.key?("error")
        raise "#{path}: expect must contain exactly one of result or error"
      end
    end
  end
end
