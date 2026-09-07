/**
 * Inline the public-safe browser WASM and install it before `<McpApp>` renders.
 *
 * A failed instantiate must not degrade to a JavaScript stand-in — the
 * error is distinctly worded so it is not confused with
 * `core sync API not installed`.
 */

import { installBrowserCoreFromBase64 } from '@solvapay/core/browser-wasm'
import wasmBase64 from 'virtual:solvapay-browser-wasm-base64'

export async function installSolvaPayWidgetCore(): Promise<void> {
  await installBrowserCoreFromBase64(wasmBase64)
}
