# TypeDoc Configuration

## Basic Configuration (`typedoc.json`)

```json
{
  "$schema": "https://typedoc.org/schema.json",
  "entryPoints": [
    "packages/server/src/index.ts",
    "packages/react/src/index.tsx",
    "packages/next/src/index.ts",
    "packages/auth/src/index.ts",
    "packages/react-supabase/src/index.ts",
    "packages/core/src/index.ts"
  ],
  "out": "docs/api",
  "readme": "README.md",
  "name": "SolvaPay SDK",
  "includeVersion": true,
  "excludePrivate": true,
  "excludeProtected": true,
  "excludeInternal": true,
  "excludeExternals": true,
  "categorizeByGroup": true,
  "categoryOrder": ["Core", "Server", "React", "Next.js", "Auth", "*"],
  "plugin": ["typedoc-plugin-markdown", "typedoc-plugin-param-names"],
  "theme": "default",
  "githubPages": false,
  "gitRevision": "main",
  "gitRemote": "origin"
}
```

## Package-Specific Configurations

For better organization, consider separate TypeDoc configs per package:

```json
// typedoc.server.json
{
  "entryPoints": ["packages/server/src/index.ts"],
  "out": "docs/api/server",
  "name": "@solvapay/server",
  "readme": "packages/server/README.md"
}
```

## Package.json Scripts

```json
{
  "scripts": {
    "docs:build": "typedoc",
    "docs:watch": "typedoc --watch",
    "docs:serve": "serve docs/api",
    "docs:check": "typedoc --json docs/api.json && node scripts/validate-docs.js"
  }
}
```
