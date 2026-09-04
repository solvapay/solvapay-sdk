# solvapay-mcp (Python)

Payable MCP adapter over the official [`mcp`](https://pypi.org/project/mcp/) SDK.
Layer 3 is hand-written Python. Paywall copy and compact `respond` text come from
the SolvaPay layer-2 native bindings — never from adapter-authored strings.

## Monorepo tests

`solvapay` is a path dependency (`../python`). `uv sync` builds that PyO3
extension in place; do not `pip install solvapay` from PyPI for this tree.

```bash
uv sync --extra dev
uv run --extra dev pytest -q
uv run --extra typecheck mypy --strict --disallow-any-explicit python/solvapay_mcp
uv run --extra typecheck pyright --project .
uv run --extra typecheck ruff check python/solvapay_mcp
```

Example (cwd is the example; the project is this package):

```bash
uv run --project . --extra dev --with uvicorn pytest -q ../../examples/python/stock-research-mcp
```

CI `pip install`s the platform `solvapay` wheel instead of the path source.
