# frozen_string_literal: true

repo_root = File.expand_path("../../../../", __dir__)
%w[sdks/ruby/lib sdks/ruby-mcp/lib].each do |rel|
  lib = File.join(repo_root, rel)
  $LOAD_PATH.unshift(lib) if File.directory?(lib)
end

Dir[File.expand_path("*_test.rb", __dir__)].sort.each { |path| require path }
