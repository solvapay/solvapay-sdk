import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** @type {import('next').NextConfig} */
/* global process */
const checkoutDemoNgrokHost = process.env.CHECKOUT_DEMO_NGROK_HOST
const __dirname = dirname(fileURLToPath(import.meta.url))
const monorepoRoot = resolve(__dirname, '../..')

const nextConfig = {
  ...(checkoutDemoNgrokHost ? { allowedDevOrigins: [checkoutDemoNgrokHost] } : {}),
  // pnpm workspace root — needed so tracing resolves workspace packages and the
  // napi .node addon next to @solvapay/server-native.
  outputFileTracingRoot: monorepoRoot,
  // Load server packages from disk so createRequire('@solvapay/server-native')
  // resolves the napi .node addon (cannot be bundled).
  // Prefer `next dev --webpack` locally: Turbopack still rebundles workspace
  // packages in this monorepo and breaks relative native imports (mitigated in
  // @solvapay/server via absolute file-URL import + webpackIgnore).
  serverExternalPackages: [
    '@solvapay/next',
    '@solvapay/server',
    '@solvapay/server-native',
    '@solvapay/server-wasm',
  ],
  transpilePackages: [
    '@solvapay/auth',
    '@solvapay/react',
    '@solvapay/core',
    '@solvapay/react-supabase',
  ],
  env: {
    NEXT_PUBLIC_SOLVAPAY_PRODUCT_REF:
      process.env.NEXT_PUBLIC_SOLVAPAY_PRODUCT_REF ??
      process.env.NEXT_PUBLIC_PRODUCT_REF ??
      process.env.SOLVAPAY_PRODUCT_REF,
  },
  // Plan docs use /api/_diag/*; Next private folders can't serve `_diag`, so rewrite.
  async rewrites() {
    return [{ source: '/api/_diag/:path*', destination: '/api/diag/:path*' }]
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // @solvapay/react re-exports a few helpers/types from @solvapay/server.
      // That can pull native.ts into the client graph; stub Node-only deps.
      config.resolve.alias = {
        ...config.resolve.alias,
        '@solvapay/server-native': false,
      }
      config.resolve.fallback = {
        ...config.resolve.fallback,
        module: false,
        'node:module': false,
      }
    }
    return config
  },
}

export default nextConfig

// OpenNext Cloudflare-for-dev patches Next into a workerd-like environment that
// cannot load napi `.node` addons. Keep it opt-in; `preview:cf` / deploy use the
// OpenNext build pipeline separately and do not need this for local Node/napi.
if (process.env.OPEN_NEXT_CLOUDFLARE_DEV === '1') {
  const { initOpenNextCloudflareForDev } = await import('@opennextjs/cloudflare')
  initOpenNextCloudflareForDev()
}
