# syntax=docker/dockerfile:1
# Build from the repository root (wrangler image_build_context).
# linux/amd64 is required for Cloudflare Containers.
FROM --platform=linux/amd64 ruby:3.3-bookworm AS build
WORKDIR /src
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential clang cmake pkg-config curl \
  && rm -rf /var/lib/apt/lists/*
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
  | sh -s -- -y --default-toolchain 1.96.0
ENV PATH="/root/.cargo/bin:${PATH}"
COPY Cargo.toml rust-toolchain.toml Cargo.lock ./
COPY core ./core
COPY sdks ./sdks
COPY tools ./tools
WORKDIR /src/sdks/ruby
RUN bundle install && bundle exec rake compile
WORKDIR /src/sdks/ruby-mcp
RUN bundle install
WORKDIR /src/examples/ruby/bitcoin_analytics_mcp
COPY examples/ruby/bitcoin_analytics_mcp ./
RUN gem install puma --no-document

FROM --platform=linux/amd64 ruby:3.3-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/sdks/ruby /src/sdks/ruby
COPY --from=build /src/sdks/ruby-mcp /src/sdks/ruby-mcp
COPY --from=build /src/examples/ruby/bitcoin_analytics_mcp /src/examples/ruby/bitcoin_analytics_mcp
COPY --from=build /usr/local/bundle /usr/local/bundle
WORKDIR /src/examples/ruby/bitcoin_analytics_mcp
ENV RUBYLIB=/src/sdks/ruby/lib:/src/sdks/ruby-mcp/lib
ENV MCP_HOST=0.0.0.0
ENV MCP_PORT=3030
EXPOSE 3030
CMD ["ruby", "main.rb", "--mode", "http"]
