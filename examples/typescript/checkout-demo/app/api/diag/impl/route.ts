import { NextResponse } from 'next/server'

type NodeModuleBuiltin = {
  createRequire: (filename: string) => (id: string) => {
    napiVersion: () => string
  }
}

/**
 * Positive confirmation that the Node (napi) Rust core is loaded.
 * `impl: "rust"` + a non-empty `napiVersion` means the Rust binding is live.
 *
 * Loads napi via process.getBuiltinModule + createRequire so bundlers cannot
 * rewrite the `.node` path (and avoid webpack `node:module` UnhandledSchemeError).
 */
export async function GET() {
  let version: string | null = null
  let error: string | undefined

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
    version = napiVersion()
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
  }

  return NextResponse.json({
    impl: 'rust',
    napiVersion: version,
    ...(error ? { error } : {}),
  })
}
