# syntax=docker/dockerfile:1
# Build from the repository root (wrangler image_build_context).
FROM --platform=linux/amd64 rust:1.96-bookworm AS wasm
WORKDIR /src
RUN rustup target add wasm32-wasip1
COPY Cargo.toml Cargo.lock rust-toolchain.toml ./
COPY core ./core
COPY sdks ./sdks
COPY tools ./tools
RUN cargo build -p solvapay-go-wasm --target wasm32-wasip1 --profile wasm-release \
  && cp target/wasm32-wasip1/wasm-release/solvapay_go_wasm.wasm /solvapay_core.wasm

FROM --platform=linux/amd64 golang:1.25-bookworm AS build
WORKDIR /src
COPY sdks/go ./sdks/go
COPY --from=wasm /solvapay_core.wasm /src/sdks/go/solvapay_core.wasm
COPY examples/go/weather-mcp ./examples/go/weather-mcp
WORKDIR /src/examples/go/weather-mcp
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /weather-mcp .

FROM --platform=linux/amd64 debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /weather-mcp /usr/local/bin/weather-mcp
ENV MCP_HOST=0.0.0.0
ENV MCP_PORT=3030
EXPOSE 3030
CMD ["weather-mcp", "-mode", "http"]
