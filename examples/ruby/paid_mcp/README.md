# Ruby SDK — paid MCP

Runnable paywalled MCP tool against a mock backend.

Point Ruby at a compiled binding (monorepo) or install the published gem, and
put `sdks/ruby-mcp/lib` on the load path:

```bash
# monorepo (after `bundle exec rake compile` in sdks/ruby):
export RUBYLIB="$(pwd)/../../../sdks/ruby/lib:$(pwd)/../../../sdks/ruby-mcp/lib${RUBYLIB:+:$RUBYLIB}"

# mcp gem:
#   cd ../../../sdks/ruby-mcp && bundle install
```

## Offline test (CI-safe)

```bash
cd examples/ruby/paid_mcp
ruby -I../../../sdks/ruby/lib -I../../../sdks/ruby-mcp/lib test/paid_mcp_test.rb
```

From `sdks/ruby-mcp` after `bundle install`:

```bash
RUBYLIB=$(pwd)/../ruby/lib bundle exec ruby -Ilib ../../examples/ruby/paid_mcp/test/paid_mcp_test.rb
```

## Run

```bash
ruby -I../../../sdks/ruby/lib -I../../../sdks/ruby-mcp/lib main.rb
ruby -I../../../sdks/ruby/lib -I../../../sdks/ruby-mcp/lib main.rb --gate
```
