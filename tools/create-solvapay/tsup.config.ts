import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  tsconfig: 'tsconfig.build.json',
  external: ['@solvapay/init'],
  banner: {
    js: '#!/usr/bin/env node',
  },
})
