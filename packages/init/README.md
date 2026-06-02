# @solvapay/init

[![npm version](https://img.shields.io/npm/v/@solvapay/init.svg)](https://www.npmjs.com/package/@solvapay/init)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Shared primitives for SolvaPay CLI tooling — browser auth, env writes, product picker, and package-manager helpers.

**When to use this package:** do not install unless you are building a scaffolder or custom CLI on top of SolvaPay init flows. End users should run [`npx solvapay init`](https://www.npmjs.com/package/solvapay) or [`npm create solvapay`](https://www.npmjs.com/package/create-solvapay).

## Consumers

- [`solvapay`](https://www.npmjs.com/package/solvapay) — `solvapay init` for existing projects
- [`create-solvapay`](https://www.npmjs.com/package/create-solvapay) — `npm create solvapay` scaffolder

## Surface

- **`runInitInDirectory({ cwd, options })`** — full init orchestration in a target directory
- Browser auth: `createInitSession`, `openAuthUrl`, `waitForExchange`, `verifySecretKey`, `verifyProductRef`
- Env writers: `writeSolvaPaySecretToEnv`, `writeSolvaPayProductRefToEnv`, `ensureEnvInGitignore`
- Product picker: `listProducts`, `pickProductInteractive`, `askKeepConfiguredProduct`
- Package managers: `detectPackageManager`, `installSolvaPaySdk`, `getInstallCommand`

## Stability

Pre-`1.0.0`. Pin an exact version if you depend on this programmatically.

## See also

- [`solvapay`](../cli) — end-user CLI
- [`create-solvapay`](../create-solvapay) — project scaffolder

## Support

- **Issues**: [GitHub Issues](https://github.com/solvapay/solvapay-sdk/issues)
- **Docs**: [docs.solvapay.com](https://docs.solvapay.com)
