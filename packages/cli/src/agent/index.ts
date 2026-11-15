// `solvapay launch` and `solvapay connect`, also importable as `solvapay/agent`
// so another package can offer the same commands under its own bin.
export { DEFAULT_API, main, parseArgs } from './connect.mjs'
export type { LauncherDeps } from './connect.mjs'
