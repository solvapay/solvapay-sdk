# Ruby SDK — get merchant

Minimal example for the SolvaPay Ruby gem. Offline TCP stub coverage for `run(...)`; live `.env` is optional.

Point Ruby at a compiled binding (monorepo) or install the published gem:

```bash
# monorepo (after `bundle exec rake compile` in sdks/ruby):
export RUBYLIB="$(pwd)/../../../sdks/ruby/lib${RUBYLIB:+:$RUBYLIB}"

# or: gem install solvapay
```

## Offline test (CI-safe)

```bash
cd examples/ruby/get_merchant
ruby -I../../../sdks/ruby/lib test/get_merchant_test.rb
```

## Setup (live run)

```bash
cp .env.example .env
# Edit .env with your sandbox secret and optional API base URL.
```

## Run

From the example directory:

```bash
ruby -I../../../sdks/ruby/lib main.rb
```
