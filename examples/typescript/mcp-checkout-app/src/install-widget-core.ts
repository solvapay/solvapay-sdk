/**
 * Install the public-safe wasm2js browser core before `<McpApp>` renders.
 *
 * A failed install must not degrade to a JavaScript stand-in — the
 * error is distinctly worded so it is not confused with
 * `core sync API not installed`.
 */

import { installBrowserCoreJs } from '@solvapay/core/browser-wasm'
import * as binding from '@solvapay/server-wasm/browser-js'

export function installSolvaPayWidgetCore(): void {
  if (binding.SOLVAPAY_BROWSER_JS_CORE !== 'solvapay-browser-js-core') {
    throw new Error('SolvaPay widget core failed to initialize: missing wasm2js marker')
  }
  installBrowserCoreJs(binding)
}
