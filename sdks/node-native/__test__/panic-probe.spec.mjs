import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

describe('panic-probe FFI containment', () => {
  it('surfaces as a JS error rather than aborting the process', async () => {
    const binding = await import('../index.js')
    if (typeof binding.panicProbe !== 'function') {
      if (process.env.SOLVAPAY_REQUIRE_PANIC_PROBE === '1') {
        assert.fail('panicProbe is missing — rebuild with --features panic-probe')
      }
      return
    }
    assert.throws(() => binding.panicProbe(), err => {
      assert.ok(err instanceof Error)
      assert.match(String(err.message), /SOLVAPAY_PANIC_PROBE|internal_error|panick/i)
      return true
    })
  })
})
