# Proxy Templates

This directory contains proxy templates for different Next.js project layouts.

## Templates

- **`proxy-root.ts`** - Template for projects without a `src/` folder
  - Place at project root as `proxy.ts`
- **`proxy-src.ts`** - Template for projects with `src/` folder structure
  - Place in `src/` folder as `proxy.ts`

## Usage

These templates are reference files. Users should copy the code from the documentation or from these files.

For detailed setup instructions, see:

- `packages/next/README.md` - Package documentation

## File Location Summary

- **Without `src/` folder**: `proxy.ts` at project root
- **With `src/` folder**: `src/proxy.ts`

## Next.js Proxy Convention

Next.js renamed the file convention from `middleware` to `proxy`.
