# Python SDK — paid MCP

Runnable paywalled MCP tool against a mock backend.

```bash
# from sdks/python-mcp (builds the local PyO3 binding):
uv sync --extra dev
uv run --extra dev python ../../examples/python/paid-mcp/main.py
uv run --extra dev python ../../examples/python/paid-mcp/main.py --gate
```

## Offline test

```bash
uv run --project ../../sdks/python-mcp --extra dev pytest -q
```
