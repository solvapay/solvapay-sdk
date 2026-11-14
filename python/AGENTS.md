# AGENTS.md — python/

The `solvapay` Python SDK. It must behave like the TypeScript SDK; the
conformance cases in `../conformance` say how.

- **Never edit `../conformance` or `../openapi` from here.** Those belong to the
  TypeScript SDK. If a case looks wrong, raise it; don't change it to pass.
- **Adopting new cases:** make them pass (add a mapping in
  `conformance_runner/` for a new `fn`), then run
  `uv run python scripts/pin_conformance.py`. Cases newer than the pin are
  skipped as "not adopted"; publishing fails until the pin catches up.
- **Generated files, never by hand:** `src/solvapay/_generated/`
  (`scripts/generate_client.py`), `src/solvapay/mcp/mcp-app.html`
  (`scripts/sync_widget.py`), the currency and tax tables (`scripts/tax_ids.mjs`),
  and `conformance.lock`.
- Check before committing: `uv run pytest`, `uv run ruff check .`,
  `uv run ruff format --check .`, `uv run mypy`.
- **Versions:** `python/package.json` (private, never on npm) is the version
  source. Bump it with a changeset naming `@solvapay/python`;
  `pnpm changeset:version` copies the version into `pyproject.toml` and the
  `uv.lock` files. Never edit the version in `pyproject.toml` by hand. It does
  not follow `@solvapay/server`.
