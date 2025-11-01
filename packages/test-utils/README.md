# @solvapay/test-utils

**Internal Package - Not Published to npm**

This package contains shared test utilities for SDK testing across packages.

## Purpose

Provides reusable test helpers, mocks, assertions, and fixtures for testing SolvaPay SDK packages.

## Status

Currently minimal - utilities will be added as needed.

## Future Contents

This package will grow to include:

- **Mock Helpers**: Mock API clients, mock backend responses
- **Custom Assertions**: Vitest/Jest custom matchers for common patterns
- **Test Fixtures**: Reusable test data and scenarios
- **Test Helpers**: Common setup/teardown functions

## Usage

```typescript
import { /* utilities will be added here */ } from '@solvapay/test-utils';
```

## Used By

- SDK packages: `@solvapay/server`, `@solvapay/client`, `@solvapay/edge`, etc.
- Integration tests across SDK packages

## Development

This package is for internal use only:
- ✅ Private package (not published)
- ✅ Used as workspace dependency
- ✅ Source files imported directly (no build step)

## Adding New Test Utilities

When adding new utilities:

1. Create the utility in `src/`
2. Export from `src/index.ts`
3. Update this README with usage documentation
4. Consider if the utility should be generic or specific to a package
