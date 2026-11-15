import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { cli: 'src/cli.ts', 'agent/index': 'src/agent/index.ts' },
  format: ['esm'],
  dts: true,
  clean: true,
  tsconfig: 'tsconfig.build.json',
  external: ['@solvapay/init'],
  banner: {
    js: '#!/usr/bin/env node',
  },
})
