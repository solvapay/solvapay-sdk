type NodeModuleBuiltin = {
  createRequire: (filename: string) => (id: string) => {
    napiVersion: () => string
  }
}

/**
 * Fail-fast boot assertion: refuse to start unless the napi binding loads.
 *
 * Uses process.getBuiltinModule('module') + createRequire so webpack/Turbopack
 * never see a `node:module` import (UnhandledSchemeError) while still loading
 * the real filesystem `.node` addon.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'edge') {
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
    // Startup diagnostic — intentional, not a warn/error path.
    // eslint-disable-next-line no-console
    console.info(`[solvapay] Rust napi core loaded (napiVersion=${version})`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(
      `@solvapay/server-native failed to load: ${message}. ` +
        `Run: pnpm --filter @solvapay/server-native build`,
    )
  }
}
