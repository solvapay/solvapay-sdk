import { afterEach, describe, expect, it } from 'vitest'
import { resolveInvokerBin } from './rust-driver.js'

describe('resolveInvokerBin', () => {
  const previous = process.env.SHADOW_INVOKER_BIN

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.SHADOW_INVOKER_BIN
    } else {
      process.env.SHADOW_INVOKER_BIN = previous
    }
  })

  it('should honor an explicit bin path over the environment', () => {
    process.env.SHADOW_INVOKER_BIN = '/tmp/from-env'
    expect(resolveInvokerBin('/tmp/explicit')).toEqual({ command: '/tmp/explicit', args: [] })
  })

  it('should honor SHADOW_INVOKER_BIN when no explicit path is given', () => {
    process.env.SHADOW_INVOKER_BIN = '/tmp/from-env'
    expect(resolveInvokerBin()).toEqual({ command: '/tmp/from-env', args: [] })
  })

  it('should cargo-run the crate instead of picking a stale prebuilt binary', () => {
    delete process.env.SHADOW_INVOKER_BIN
    expect(resolveInvokerBin()).toEqual({
      command: 'cargo',
      args: ['run', '-q', '-p', 'shadow-invoker'],
    })
  })
})
