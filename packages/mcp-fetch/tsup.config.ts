import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  tsconfig: 'tsconfig.build.json',
  clean: true,
  external: [
    '@modelcontextprotocol/ext-apps',
    '@modelcontextprotocol/sdk',
    '@solvapay/mcp-core',
    '@solvapay/server',
    '@solvapay/core',
    'zod',
  ],
})
