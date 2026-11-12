import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/mcp.ts', 'src/http.ts', 'src/testing.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  tsconfig: 'tsconfig.build.json',
  external: ['@solvapay/server', '@solvapay/core'],
})
