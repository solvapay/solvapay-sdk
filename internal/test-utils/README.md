# @solvapay/test-utils

**Internal package — not published to npm**

Shared test utilities for the SolvaPay SDK monorepo.

## Purpose

Reusable test helpers, mocks, assertions, and fixtures for testing SDK packages.

## Status

Currently minimal — utilities are added as needed.

## Used by

- `@solvapay/server`, `@solvapay/react`, `@solvapay/mcp`, and other workspace packages
- Integration tests across the monorepo

## Development

- Private workspace dependency only
- Source files imported directly (no build step)

When adding utilities: create in `src/`, export from `src/index.ts`, document usage here.

## See also

- [SDK testing guide](../../docs/contributing/testing.md)
