# @solvapay/init

Shared primitives for SolvaPay CLI tooling. Consumed by:

- [`solvapay`](https://www.npmjs.com/package/solvapay) — the `solvapay init` CLI for existing projects
- [`create-solvapay`](https://www.npmjs.com/package/create-solvapay) — the `npm create solvapay` scaffolder

## Surface

This package exports the building blocks for SolvaPay's CLI flows:

- **`runInitInDirectory({ cwd, options })`** — the full init orchestration (browser auth, env writes, optional SDK install, product picker) targeted at a specific directory.
- Browser-based device-code auth: `createInitSession`, `openAuthUrl`, `waitForExchange`, `verifySecretKey`, `verifyProductRef`.
- `.env` and `.gitignore` writers: `writeSolvaPaySecretToEnv`, `writeSolvaPayProductRefToEnv`, `ensureEnvInGitignore`, `readSolvaPayProductRefFromEnv`.
- Product picker: `listProducts`, `pickProductInteractive`, `askKeepConfiguredProduct`, `formatConfiguredProductLabel`.
- Package-manager helpers: `detectPackageManager`, `installSolvaPaySdk`, `getInstallCommand`, `getSolvaPayBasePackages`.
- Project helpers: `ensureNodeProject`, `waitForEnter`.

## Stability

Pre-`1.0.0`. The surface evolves with the consumer CLIs; pin an exact version if you build your own scaffolder against it.
