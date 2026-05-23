import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  tsconfig: 'tsconfig.build.json',
  external: ['@solvapay/cli-core'],
  banner: {
    js: '#!/usr/bin/env node',
  },
})
