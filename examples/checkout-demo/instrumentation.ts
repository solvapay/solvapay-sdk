type NodeModuleBuiltin = {
  createRequire: (filename: string) => (id: string) => {
    napiVersion: () => string
  }
}

/**
 * Fail-fast boot assertion: when SOLVAPAY_IMPL=rust, refuse to start unless
 * the napi binding loads. Prevents accidentally testing the TS fallback.
 *
 * Uses process.getBuiltinModule('module') + createRequire so webpack/Turbopack
 * never see a `node:module` import (UnhandledSchemeError) while still loading
 * the real filesystem `.node` addon.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'edge') {
    return
  }

  if (process.env.SOLVAPAY_IMPL !== 'rust') {
    return
  }

  try {
    const nodeModule = (
      process as NodeJS.Process & {
        getBuiltinModule?: (id: string) => NodeModuleBuiltin | undefined
      }
    ).getBuiltinModule?.('module')

    if (!nodeModule?.createRequire) {
      throw new Error('process.getBuiltinModule("module") is unavailable')
    }

    const require = nodeModule.createRequire(`${process.cwd()}/package.json`)
    const { napiVersion } = require('@solvapay/server-native')
    const version = napiVersion()
    console.info(`[solvapay] Rust napi core loaded (napiVersion=${version})`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(
      `SOLVAPAY_IMPL=rust but @solvapay/server-native failed to load: ${message}. ` +
        `Run: pnpm --filter @solvapay/server-native build`,
    )
  }
}
