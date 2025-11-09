# Middleware Templates

This directory contains middleware/proxy templates for different Next.js versions.

## Templates

- **`middleware-next15.ts`** - Template for Next.js 15 projects
  - Place at project root as `middleware.ts`
- **`middleware-next16.ts`** - Template for Next.js 16 projects with `src/` folder structure
  - Place in `src/` folder as `proxy.ts`
  - Uses `proxy` export to avoid deprecation warnings

## Usage

These templates are reference files. Users should copy the code from the documentation or from these files.

For detailed setup instructions, see:

- `packages/create-solvapay-app/guides/02-authentication.md` - Authentication guide
- `packages/next/README.md` - Package documentation

## File Location Summary

- **Next.js 15**: `middleware.ts` at project root
- **Next.js 16 without `src/` folder**: `proxy.ts` at project root
- **Next.js 16 with `src/` folder**: `src/proxy.ts`

## Next.js 16 Changes

Next.js 16 renamed "middleware" to "proxy".
