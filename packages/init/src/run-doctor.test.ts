import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runDoctorInDirectory } from './run-doctor'

vi.mock('./browser-auth', () => ({
  verifySecretKey: vi.fn(),
  verifyProductRef: vi.fn(),
}))

vi.mock('./env', () => ({
  readSolvaPaySecretKeyFromEnv: vi.fn(),
  readSolvaPayApiBaseUrlFromEnv: vi.fn(),
  readSolvaPayProductRefFromEnv: vi.fn(),
  SOLVAPAY_PRODUCT_REF_PLACEHOLDER: '__SOLVAPAY_PRODUCT_REF__',
}))

import { verifyProductRef, verifySecretKey } from './browser-auth'
import {
  readSolvaPayApiBaseUrlFromEnv,
  readSolvaPayProductRefFromEnv,
  readSolvaPaySecretKeyFromEnv,
} from './env'

const TEST_CWD = '/tmp/doctor-project'

describe('runDoctorInDirectory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.SOLVAPAY_SECRET_KEY
    delete process.env.SOLVAPAY_PRODUCT_REF
    delete process.env.SOLVAPAY_API_BASE_URL
    delete process.env.SOLVAPAY_DEBUG
    vi.mocked(readSolvaPayApiBaseUrlFromEnv).mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fails when the secret key is missing', async () => {
    vi.mocked(readSolvaPaySecretKeyFromEnv).mockResolvedValue(undefined)
    vi.mocked(readSolvaPayProductRefFromEnv).mockResolvedValue(undefined)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ status: 401, ok: false }),
    )

    const report = await runDoctorInDirectory({ cwd: TEST_CWD })

    expect(report.ok).toBe(false)
    expect(report.checks.find(c => c.name === 'SOLVAPAY_SECRET_KEY')?.ok).toBe(false)
  })

  it('passes when secret, product, and readiness are good', async () => {
    vi.mocked(readSolvaPaySecretKeyFromEnv).mockResolvedValue('sk_test')
    vi.mocked(readSolvaPayProductRefFromEnv).mockResolvedValue('prd_ready')
    vi.mocked(verifySecretKey).mockResolvedValue({ ok: true })
    vi.mocked(verifyProductRef).mockResolvedValue({
      status: 'ok',
      product: {
        name: 'Ready Product',
        status: 'active',
        plans: [{ isActive: true }],
      },
    })

    const report = await runDoctorInDirectory({ cwd: TEST_CWD })

    expect(report.ok).toBe(true)
    expect(report.checks.find(c => c.name === 'Product readiness')?.ok).toBe(true)
  })

  it('fails when the product has no active plans', async () => {
    vi.mocked(readSolvaPaySecretKeyFromEnv).mockResolvedValue('sk_test')
    vi.mocked(readSolvaPayProductRefFromEnv).mockResolvedValue('prd_empty')
    vi.mocked(verifySecretKey).mockResolvedValue({ ok: true })
    vi.mocked(verifyProductRef).mockResolvedValue({
      status: 'ok',
      product: {
        name: 'Empty',
        status: 'active',
        plans: [],
      },
    })

    const report = await runDoctorInDirectory({ cwd: TEST_CWD })

    expect(report.ok).toBe(false)
    expect(report.checks.find(c => c.name === 'Product readiness')?.ok).toBe(false)
  })

  it('targets api-dev when --dev is set', async () => {
    vi.mocked(readSolvaPaySecretKeyFromEnv).mockResolvedValue(undefined)
    vi.mocked(readSolvaPayProductRefFromEnv).mockResolvedValue(undefined)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ status: 401, ok: false }),
    )

    const report = await runDoctorInDirectory({ cwd: TEST_CWD, options: { dev: true } })

    expect(report.apiBaseUrl).toBe('https://api-dev.solvapay.com')
  })
})
