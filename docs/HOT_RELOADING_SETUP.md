# Hot Reloading Setup Guide

This guide explains how to set up hot reloading for the SolvaPay SDK monorepo, allowing you to see changes to SDK packages instantly in example applications without manual rebuilds.

## Problem

By default, when you modify a package in the SDK (e.g., `packages/react`), you need to:
1. Manually rebuild the package (`pnpm build`)
2. Restart the example application
3. Wait for compilation

This slows down development significantly, especially when iterating on SDK features.

## Solution Overview

We use **Turbo's watch mode** combined with **tsup's watch flag** to automatically rebuild packages when source files change. Next.js Fast Refresh then picks up these changes automatically.

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Developer edits package source file                    │
└──────────────────┬──────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────┐
│  tsup --watch detects change & rebuilds dist/          │
└──────────────────┬──────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────┐
│  Next.js detects dist/ change via transpilePackages     │
└──────────────────┬──────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────┐
│  Fast Refresh applies changes to running app            │
└─────────────────────────────────────────────────────────┘
```

## Implementation Steps

### Step 1: Add `dev` Scripts to Buildable Packages

Add a `dev` script to each package that builds with `tsup`. The script should mirror the `build` script but add the `--watch` flag.

#### `packages/core/package.json`

```json
{
  "scripts": {
    "build": "tsup src/index.ts --format esm,cjs --dts --tsconfig tsconfig.build.json",
    "dev": "tsup src/index.ts --format esm,cjs --dts --tsconfig tsconfig.build.json --watch"
  }
}
```

#### `packages/auth/package.json`

```json
{
  "scripts": {
    "build": "tsup src/index.ts src/supabase.ts src/mock.ts src/next-utils.ts --format esm,cjs --dts --tsconfig tsconfig.build.json",
    "dev": "tsup src/index.ts src/supabase.ts src/mock.ts src/next-utils.ts --format esm,cjs --dts --tsconfig tsconfig.build.json --watch"
  }
}
```

#### `packages/server/package.json`

```json
{
  "scripts": {
    "build": "tsup src/index.ts --format esm,cjs --dts --tsconfig tsconfig.build.json && tsup src/edge.ts --format esm --dts --tsconfig tsconfig.build.json",
    "dev": "tsup src/index.ts src/edge.ts --format esm,cjs --dts --tsconfig tsconfig.build.json --watch"
  }
}
```

**Note:** For `server`, we combine both entry points in a single watch command since `tsup --watch` can handle multiple entries.

#### `packages/react/package.json`

```json
{
  "scripts": {
    "build": "tsup src/index.tsx src/adapters/auth.ts --format esm,cjs --dts --tsconfig tsconfig.build.json",
    "dev": "tsup src/index.tsx src/adapters/auth.ts --format esm,cjs --dts --tsconfig tsconfig.build.json --watch"
  }
}
```

#### `packages/next/package.json`

```json
{
  "scripts": {
    "build": "tsup src/index.ts --format esm,cjs --dts --tsconfig tsconfig.build.json --external next",
    "dev": "tsup src/index.ts --format esm,cjs --dts --tsconfig tsconfig.build.json --external next --watch"
  }
}
```

#### `packages/react-supabase/package.json`

```json
{
  "scripts": {
    "build": "tsup src/index.ts --format esm,cjs --dts --tsconfig tsconfig.build.json",
    "dev": "tsup src/index.ts --format esm,cjs --dts --tsconfig tsconfig.build.json --watch"
  }
}
```

### Step 2: Update `turbo.json`

Configure Turbo to handle watch mode with proper dependency ordering:

```json
{
  "$schema": "https://turbo.build/schema.json",
  "globalPassThroughEnv": [
    "SOLVAPAY_API_KEY",
    "SOLVAPAY_AGENT",
    "OAUTH_ISSUER",
    "OAUTH_CLIENT_ID",
    "OAUTH_CLIENT_SECRET",
    "OAUTH_REDIRECT_URI",
    "OAUTH_JWKS_SECRET",
    "REDIS_URL",
    "SESSION_SECRET",
    "OAUTH_ALLOW_ANY_USER"
  ],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**", "generated/**"],
      "env": ["PUBLIC_URL"]
    },
    "@example/express-basic#build": {
      "dependsOn": ["^build"],
      "outputs": []
    },
    "@example/mcp-basic#build": {
      "dependsOn": ["^build"],
      "outputs": []
    },
    "@example/nextjs-openai-custom-gpt-actions#build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "!.next/cache/**", "generated/**"]
    },
    "dev": {
      "persistent": true,
      "cache": false,
      "dependsOn": ["^build"]
    },
    "@solvapay/core#dev": {
      "cache": false,
      "persistent": true
    },
    "@solvapay/auth#dev": {
      "dependsOn": ["^build"],
      "cache": false,
      "persistent": true
    },
    "@solvapay/server#dev": {
      "dependsOn": ["^build"],
      "cache": false,
      "persistent": true
    },
    "@solvapay/react#dev": {
      "dependsOn": ["^build"],
      "cache": false,
      "persistent": true
    },
    "@solvapay/next#dev": {
      "dependsOn": ["^build"],
      "cache": false,
      "persistent": true
    },
    "@solvapay/react-supabase#dev": {
      "dependsOn": ["^build"],
      "cache": false,
      "persistent": true
    },
    "lint": {},
    "test": {
      "dependsOn": ["^build"],
      "outputs": []
    },
    "release": {
      "dependsOn": ["build", "test"]
    }
  }
}
```

**Key Configuration Points:**

- `"persistent": true` - Tells Turbo these tasks run indefinitely (watch mode)
- `"cache": false` - Disables caching for dev tasks (always run fresh)
- `"dependsOn": ["^build"]` - Ensures dependencies are built once before watch starts
  - The `^` prefix means "dependencies of this package"
  - This ensures `@solvapay/core` builds before `@solvapay/server` starts watching

### Step 3: Update Next.js Configurations

Next.js needs to watch for changes in package `dist/` folders. Update each Next.js example's config:

#### `examples/hosted-checkout-demo/next.config.mjs`

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    '@solvapay/react',
    '@solvapay/server',
    '@solvapay/core',
    '@solvapay/next',
    '@solvapay/auth',
    '@solvapay/react-supabase',
  ],
  // Watch for changes in package dist folders
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [
          '**/node_modules/**',
          '!**/node_modules/@solvapay/**/dist/**',
        ],
      };
    }
    return config;
  },
};

export default nextConfig;
```

#### `examples/checkout-demo/next.config.mjs`

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    '@solvapay/react',
    '@solvapay/server',
    '@solvapay/core',
    '@solvapay/next',
    '@solvapay/auth',
    '@solvapay/react-supabase',
  ],
  // Watch for changes in package dist folders
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [
          '**/node_modules/**',
          '!**/node_modules/@solvapay/**/dist/**',
        ],
      };
    }
    return config;
  },
};

export default nextConfig;
```

#### `examples/nextjs-openai-custom-gpt-actions/next.config.js`

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    '@solvapay/react',
    '@solvapay/server',
    '@solvapay/core',
    '@solvapay/next',
    '@solvapay/auth',
    '@solvapay/react-supabase',
  ],
  // Watch for changes in package dist folders
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [
          '**/node_modules/**',
          '!**/node_modules/@solvapay/**/dist/**',
        ],
      };
    }
    return config;
  },
};

module.exports = nextConfig;
```

**What This Does:**

- `transpilePackages` - Tells Next.js to transpile these packages (needed for ESM/CJS compatibility)
- `webpack.watchOptions` - Ensures Next.js watches `dist/` folders inside `node_modules/@solvapay/`
  - By default, Next.js ignores all `node_modules/`
  - We exclude `@solvapay` packages from that ignore list

### Step 4: (Optional) Add Convenience Scripts

Add helper scripts to the root `package.json` for common workflows:

```json
{
  "scripts": {
    "dev": "turbo dev --no-cache --concurrency 16 --continue",
    "dev:packages": "turbo dev --filter=@solvapay/* --no-cache",
    "dev:examples": "turbo dev --filter=@example/* --no-cache",
    "dev:hosted-checkout": "turbo dev --filter=@solvapay/* --filter=@example/hosted-checkout-demo --no-cache",
    "dev:checkout": "turbo dev --filter=@solvapay/* --filter=@example/checkout-demo --no-cache",
    "dev:express": "turbo dev --filter=@solvapay/* --filter=@example/express-basic --no-cache"
  }
}
```

## Usage

### Run Everything

Start all packages in watch mode and all examples:

```bash
pnpm dev
```

This will:
1. Build all packages once (initial build)
2. Start watch mode for all packages
3. Start all example dev servers

### Run Specific Example with Dependencies

Run only the packages needed for a specific example:

```bash
# Hosted checkout demo
pnpm dev:hosted-checkout

# Or using turbo directly
turbo dev --filter=@solvapay/* --filter=@example/hosted-checkout-demo
```

### Run Only Packages

Develop library code without running examples:

```bash
pnpm dev:packages
```

### Run Specific Packages + Example

Target exactly what you need:

```bash
turbo dev \
  --filter=@solvapay/react \
  --filter=@solvapay/core \
  --filter=@example/hosted-checkout-demo
```

## How It Works

### Initial Startup

1. **Turbo analyzes dependencies** - Determines build order (e.g., `core` before `server`)
2. **Initial build** - All packages build once via `dependsOn: ["^build"]`
3. **Watch mode starts** - All `dev` scripts start in parallel
4. **Examples start** - Next.js dev servers or nodemon start

### Change Detection Flow

1. **Developer edits** `packages/react/src/SolvaPayProvider.tsx`
2. **tsup detects change** - The `--watch` flag monitors source files
3. **Rebuild triggers** - `tsup` rebuilds `packages/react/dist/`
4. **Next.js detects change** - Webpack watches `dist/` folders (via config)
5. **Fast Refresh applies** - Changes appear in browser automatically

### Dependency Handling

- **Turbo respects dependencies** - If `@solvapay/server` depends on `@solvapay/core`, Turbo ensures `core` is built before `server` watches
- **Change propagation** - If you change `core`, all dependent packages rebuild automatically
- **No manual steps** - Everything happens automatically

## Troubleshooting

### Changes Not Appearing

**Problem:** You edit a package but changes don't appear in the example.

**Solutions:**
1. **Check watch is running** - Look for `tsup` output showing "watching for changes"
2. **Verify Next.js config** - Ensure `transpilePackages` includes the package
3. **Check webpack watch** - Ensure `watchOptions` is configured correctly
4. **Restart dev server** - Sometimes Next.js needs a restart: `Ctrl+C` then `pnpm dev` again

### Build Errors in Watch Mode

**Problem:** `tsup --watch` shows build errors.

**Solutions:**
1. **Fix TypeScript errors** - Watch mode shows errors, fix them
2. **Check dependencies** - Ensure all dependencies are installed (`pnpm install`)
3. **Verify tsconfig** - Check `tsconfig.build.json` is correct

### Turbo Not Starting Watch Mode

**Problem:** `pnpm dev` doesn't start watch mode.

**Solutions:**
1. **Check Turbo version** - Ensure Turbo >= 2.0.6 (check `package.json`)
2. **Verify persistent flag** - Ensure `"persistent": true` in `turbo.json`
3. **Check for errors** - Look for build errors preventing watch from starting

### Next.js Not Picking Up Changes

**Problem:** Package rebuilds but Next.js doesn't reload.

**Solutions:**
1. **Verify transpilePackages** - Package must be in the array
2. **Check webpack config** - Ensure `watchOptions` allows watching `dist/`
3. **Clear Next.js cache** - Delete `.next` folder and restart
4. **Check file permissions** - Ensure Next.js can read `dist/` files

### Multiple Watch Processes Consuming Resources

**Problem:** Too many watch processes slow down your machine.

**Solutions:**
1. **Use filters** - Only run what you need: `turbo dev --filter=@solvapay/react`
2. **Close unused terminals** - Stop watch processes you're not using
3. **Reduce concurrency** - Use `--concurrency 8` instead of `16`

## Best Practices

1. **Use filters** - Don't run everything if you're only working on one package
2. **One terminal per workflow** - Run `dev` commands in separate terminals if needed
3. **Monitor build output** - Watch for TypeScript errors in `tsup` output
4. **Regular builds** - Still run `pnpm build` before committing to ensure production builds work
5. **Clean builds** - Occasionally run `pnpm clean && pnpm build` to ensure everything is fresh

## Express/MCP Examples

Express and MCP examples use `nodemon` which already watches `dist/` folders:

```json
// examples/express-basic/package.json
"dev": "nodemon --watch src --watch ../../packages/server/dist --watch ../../packages/core/dist --ext ts,js,mjs --exec \"tsx src/index.ts\""
```

This setup works automatically with the watch mode - when packages rebuild, `nodemon` detects the change and restarts the server.

## Summary

With this setup:
- ✅ **No manual rebuilds** - Packages rebuild automatically
- ✅ **Fast iteration** - Changes appear in seconds
- ✅ **Dependency-aware** - Turbo handles build order
- ✅ **Works everywhere** - Next.js, Express, and MCP examples
- ✅ **Production-safe** - `build` scripts remain unchanged

Happy coding! 🚀

