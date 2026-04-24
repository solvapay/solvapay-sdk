import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  tsconfig: 'tsconfig.build.json',
  clean: true,
  external: [
    '@modelcontextprotocol/sdk',
    '@solvapay/mcp',
    '@solvapay/mcp-core',
    '@solvapay/core',
  ],
})
