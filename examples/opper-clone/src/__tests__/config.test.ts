import { describe, expect, it } from 'vitest'
import { loadConfig } from '../config'

const ENV = {
  PORT: '3040',
  OPPER_BASE_URL: 'https://api.opper.test/',
  OPPER_MANAGEMENT_KEY: 'op-mak-test',
  CLONE_KEY_ENCRYPTION_KEY: 'key',
  SOLVAPAY_AGENT_ISSUER: 'https://api.solvapay.test/v1/agent',
  SOLVAPAY_AGENT_JWKS_URL: 'http://localhost:3010/v1/agent/jwks.json',
  SOLVAPAY_PROVIDER_REF: 'prov_TEST',
  SOLVAPAY_API_BASE_URL: 'http://localhost:3010',
  SOLVAPAY_SECRET_KEY: 'sk_sandbox_test',
  SOLVAPAY_PRODUCT_REF: 'prd_TEST',
}

describe('loadConfig', () => {
  it('reads the settings and fails on a missing one', () => {
    expect(loadConfig(ENV)).toMatchObject({ port: 3040, opperBaseUrl: 'https://api.opper.test' })
    expect(() => loadConfig({ ...ENV, SOLVAPAY_SECRET_KEY: ' ' })).toThrow(
      'SOLVAPAY_SECRET_KEY is not set',
    )
  })

  it.each([
    [undefined, 60],
    ['', 60],
    ['15', 15],
    [' 1 ', 1],
    ['0', 0],
  ])('reads RECONCILE_EVERY_MINUTES=%j as %d', (value, minutes) => {
    expect(loadConfig({ ...ENV, RECONCILE_EVERY_MINUTES: value }).reconcileEveryMinutes).toBe(
      minutes,
    )
  })

  it.each(['-5', '1.5', 'hourly', '1e3', '99999999999999999999'])(
    'refuses RECONCILE_EVERY_MINUTES=%j',
    value => {
      expect(() => loadConfig({ ...ENV, RECONCILE_EVERY_MINUTES: value })).toThrow(
        /RECONCILE_EVERY_MINUTES must be a whole number/,
      )
    },
  )
})
