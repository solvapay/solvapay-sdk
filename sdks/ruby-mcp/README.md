# solvapay-mcp (Ruby)

Payable MCP adapter over the official [`mcp`](https://rubygems.org/gems/mcp) gem.
Layer 3 is hand-written Ruby. Paywall copy and compact `respond` text come from
the SolvaPay layer-2 native bindings — never from adapter-authored strings.

`SolvaPay::Mcp` and the host `MCP` constant differ only by case. Always spell
the host SDK as `::MCP::...`.

The host gem parses transport JSON with `symbolize_names: true` and splats tool
arguments as keywords, so merchant handlers see **symbol** keys. Native
`call_sync` returns **string**-keyed Hashes. This adapter JSON-round-trips at
the seam rather than mixing key types.

## Monorepo tests

`solvapay` is not a Bundler path gem (that would compile Magnus from source).
Point Ruby at the compiled binding, then bundle this package:

```bash
# after `bundle exec rake compile` in sdks/ruby:
export RUBYLIB="$(pwd)/../ruby/lib${RUBYLIB:+:$RUBYLIB}"
bundle install
bundle exec rake test
bundle exec rubocop lib --no-parallel
bundle exec steep check
bundle exec rbs validate
```

CI `gem install`s the platform `solvapay` artifact instead of `RUBYLIB`.
