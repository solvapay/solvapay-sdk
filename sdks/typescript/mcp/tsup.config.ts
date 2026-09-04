import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsup'
import type { Plugin } from 'esbuild'

const sharedExternal = [
  '@modelcontextprotocol/core',
  '@modelcontextprotocol/server',
  '@solvapay/mcp-core',
  '@solvapay/server',
  '@solvapay/core',
  'zod',
] as const

const edgeHtmlPath = fileURLToPath(new URL('./src/defaultMcpAppHtml.edge.ts', import.meta.url))

function resolveEdgeHtml(): Plugin {
  return {
    name: 'resolve-edge-html',
    setup(build) {
      build.onResolve({ filter: /^#mcp-app-html$/ }, () => ({ path: edgeHtmlPath }))
    },
  }
}

export default defineConfig([
  {
    entry: ['src/index.ts', 'src/fetch/index.ts', 'src/express/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    tsconfig: 'tsconfig.build.json',
    clean: true,
    shims: true,
    external: [...sharedExternal],
  },
  {
    entry: ['src/edge.ts'],
    format: ['esm'],
    dts: true,
    tsconfig: 'tsconfig.build.json',
    clean: false,
    esbuildPlugins: [resolveEdgeHtml()],
    external: [...sharedExternal],
  },
  {
    entry: { 'fetch/edge': 'src/fetch/index.ts' },
    format: ['esm'],
    dts: false,
    tsconfig: 'tsconfig.build.json',
    clean: false,
    esbuildPlugins: [resolveEdgeHtml()],
    external: [...sharedExternal],
  },
])
