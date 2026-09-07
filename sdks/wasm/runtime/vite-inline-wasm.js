/**
 * Vite plugin: emit the browser WASM as a base64 string import.
 *
 * Host `connect-src` rejects `data:` URLs, so this is a JS string — not
 * `data:application/wasm;base64,…`. Also strips wasm-bindgen's
 * `new URL('…wasm', import.meta.url)` so Vite does not emit a second
 * asset copy of the same module.
 */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const VIRTUAL_ID = 'virtual:solvapay-browser-wasm-base64'
const RESOLVED_VIRTUAL_ID = `\0${VIRTUAL_ID}`

export function defaultBrowserWasmPath() {
  const require = createRequire(import.meta.url)
  const pkgRoot = dirname(require.resolve('@solvapay/server-wasm/package.json'))
  return join(pkgRoot, 'pkg/browser/solvapay_wasm_bg.wasm')
}

export function inlineBrowserWasmBase64(wasmPath = defaultBrowserWasmPath()) {
  return {
    name: 'inline-browser-wasm-base64',
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_VIRTUAL_ID
      return null
    },
    load(id) {
      if (id !== RESOLVED_VIRTUAL_ID) return null
      if (!existsSync(wasmPath)) {
        throw new Error(`SolvaPay browser WASM missing at ${wasmPath}`)
      }
      return `export default ${JSON.stringify(readFileSync(wasmPath).toString('base64'))}`
    },
    transform(code, id) {
      if (!id.includes('solvapay_wasm') && !id.includes('browser-web.js')) {
        return null
      }
      const next = code.replace(
        /new URL\((['"`])[^'"`]*solvapay_wasm_bg\.wasm\1\s*,\s*import\.meta\.url\)/g,
        'undefined',
      )
      return next === code ? null : { code: next, map: null }
    },
  }
}
