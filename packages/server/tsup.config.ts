import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    tsconfig: 'tsconfig.build.json',
    clean: true,
    external: ['@solvapay/core', '@solvapay/auth', 'zod', 'jose'],
  },
  {
    entry: ['src/edge.ts'],
    format: ['esm'],
    dts: true,
    tsconfig: 'tsconfig.build.json',
    clean: false,
    external: ['@solvapay/core', '@solvapay/auth', 'zod', 'jose'],
  },
])
