/**
 * Canonical Next.js config for SolvaPay examples that load `@solvapay/server`
 * (and therefore the napi `@solvapay/server-native` addon).
 *
 * Next must keep those packages on disk — bundling the napi loader breaks
 * both webpack and Turbopack. Use with `next build --webpack` /
 * `next dev --webpack`: Turbopack still rebundles workspace packages in this
 * monorepo and cannot place the native binding in an ESM chunk.
 */
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const NATIVE_PACKAGES = [
  '@solvapay/next',
  '@solvapay/server',
  '@solvapay/server-native',
  '@solvapay/server-wasm',
]

/** Origins `next dev` accepts for HMR when the app is opened via 127.0.0.1 or localhost. */
const DEV_ORIGINS = ['127.0.0.1', 'localhost']

/**
 * @param {string} fromUrl `import.meta.url` of the consuming `next.config.mjs`
 * @returns {string} Absolute path to the pnpm workspace root
 */
export function findMonorepoRoot(fromUrl) {
  let dir = dirname(fileURLToPath(fromUrl))
  while (dir !== dirname(dir)) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) {
      return dir
    }
    dir = dirname(dir)
  }
  throw new Error(
    'Could not find monorepo root (pnpm-workspace.yaml) from next.config.mjs',
  )
}

/**
 * @param {import('next').NextConfig} [config]
 * @param {{ importMetaUrl: string }} options
 * @returns {import('next').NextConfig}
 */
export function withSolvaPayNextConfig(config = {}, options) {
  if (!options?.importMetaUrl) {
    throw new Error('withSolvaPayNextConfig requires { importMetaUrl: import.meta.url }')
  }

  const monorepoRoot = findMonorepoRoot(options.importMetaUrl)
  const prevWebpack = config.webpack
  const transpilePackages = (config.transpilePackages ?? []).filter(
    pkg => !NATIVE_PACKAGES.includes(pkg),
  )

  return {
    ...config,
    outputFileTracingRoot: monorepoRoot,
    allowedDevOrigins: [
      ...new Set([...(config.allowedDevOrigins ?? []), ...DEV_ORIGINS]),
    ],
    serverExternalPackages: [
      ...new Set([...(config.serverExternalPackages ?? []), ...NATIVE_PACKAGES]),
    ],
    transpilePackages,
    webpack: (webpackConfig, ctx) => {
      const nextConfig = prevWebpack ? prevWebpack(webpackConfig, ctx) : webpackConfig
      if (ctx.isServer && ctx.nextRuntime !== 'edge') {
        // `serverExternalPackages` only matches resolved realpaths under
        // node_modules. Workspace packages with a `development` condition
        // resolve to `src/*.ts` outside that gate, so webpack still bundles
        // the napi `.node` addon. A request-name external is consulted
        // before resolution and is immune to that hole. Skip the Edge
        // compiler — it has no napi, and `commonjs` externals cannot load
        // `@solvapay/server-wasm` there.
        const existing = Array.isArray(nextConfig.externals)
          ? nextConfig.externals
          : [nextConfig.externals].filter(Boolean)
        nextConfig.externals = [
          ({ request }, callback) =>
            NATIVE_PACKAGES.includes(request)
              ? callback(null, `commonjs ${request}`)
              : callback(),
          ...existing,
        ]
      }
      if (!ctx.isServer) {
        // @solvapay/react can pull server types into the client graph; stub Node-only deps.
        nextConfig.resolve.alias = {
          ...nextConfig.resolve.alias,
          '@solvapay/server-native': false,
        }
        nextConfig.resolve.fallback = {
          ...nextConfig.resolve.fallback,
          module: false,
          'node:module': false,
        }
      }
      return nextConfig
    },
  }
}
