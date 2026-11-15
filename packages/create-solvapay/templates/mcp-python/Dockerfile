# A container for __SERVER_NAME__. Settings come from the host's environment
# (SOLVAPAY_SECRET_KEY, SOLVAPAY_PRODUCT_REF, PUBLIC_BASE_URL); .env is not
# copied in. Hosts such as Cloud Run set PORT.
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY . .

ENV PORT=8080
EXPOSE 8080
CMD ["uv", "run", "--no-sync", "python", "server.py"]
