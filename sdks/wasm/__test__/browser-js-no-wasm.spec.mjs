import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

describe('@solvapay/server-wasm/browser-js without WebAssembly', () => {
  it('resolveDisplayMode still returns after WebAssembly is deleted', async () => {
    delete globalThis.WebAssembly
    const core = await import('../runtime/browser-js.js')
    assert.equal(typeof globalThis.WebAssembly, 'undefined')
    assert.equal(core.SOLVAPAY_BROWSER_JS_CORE, 'solvapay-browser-js-core')
    const envelope = JSON.parse(core.resolveDisplayMode(JSON.stringify({ ctx: null })))
    assert.equal(envelope.ok, true)
    assert.equal(envelope.value.displayMode, 'inline')
  })
})
