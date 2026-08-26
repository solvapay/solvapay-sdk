import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/index.tsx',
    'src/primitives/index.ts',
    'src/adapters/auth.ts',
    'src/adapters/auth0.ts',
    'src/adapters/session-auth.ts',
    'src/mcp/index.ts',
  ],
  format: ['esm', 'cjs'],
  dts: true,
  tsconfig: 'tsconfig.build.json',
  // Never bundle the server SDK — its main entry installs native/WASM and
  // must stay out of the browser graph. Type-only imports are erased.
  external: [
    '@solvapay/server',
    '@solvapay/core',
    '@solvapay/core/browser-wasm',
    '@solvapay/core/portable',
    '@solvapay/mcp-core',
    '@solvapay/server-wasm',
    '@solvapay/server-wasm/browser',
    'react',
    'react-dom',
    'react/jsx-runtime',
    '@stripe/react-stripe-js',
    '@stripe/stripe-js',
  ],
})
