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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 401, ok: false }))

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

  it('fails the @solvapay/* versions check when an installed package is behind npm', async () => {
    const { mkdir, mkdtemp, rm, writeFile } = await import('node:fs/promises')
    const os = await import('node:os')
    const path = await import('node:path')
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'doctor-outdated-'))
    try {
      await writeFile(path.join(cwd, 'package.json'), JSON.stringify({ dependencies: { '@solvapay/mcp': '^0.4.3' } }))
      await mkdir(path.join(cwd, 'node_modules', '@solvapay', 'mcp'), { recursive: true })
      await writeFile(
        path.join(cwd, 'node_modules', '@solvapay', 'mcp', 'package.json'),
        JSON.stringify({ name: '@solvapay/mcp', version: '0.4.3' }),
      )
      vi.mocked(readSolvaPaySecretKeyFromEnv).mockResolvedValue(undefined)
      vi.mocked(readSolvaPayProductRefFromEnv).mockResolvedValue(undefined)
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 401, ok: false }))

      const report = await runDoctorInDirectory({ cwd, distTags: async () => ({ latest: '0.5.0' }) })
      const check = report.checks.find(c => c.name === '@solvapay/* versions')

      expect(check?.ok).toBe(false)
      expect(check?.detail).toContain('@solvapay/mcp 0.4.3 (npm latest 0.5.0)')
      expect(check?.detail).toContain('install --save-exact @solvapay/mcp@0.5.0')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('targets api-dev when --dev is set', async () => {
    vi.mocked(readSolvaPaySecretKeyFromEnv).mockResolvedValue(undefined)
    vi.mocked(readSolvaPayProductRefFromEnv).mockResolvedValue(undefined)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 401, ok: false }))

    const report = await runDoctorInDirectory({ cwd: TEST_CWD, options: { dev: true } })

    expect(report.apiBaseUrl).toBe('https://api-dev.solvapay.com')
  })

  it('lets --api-base win over --dev', async () => {
    vi.mocked(readSolvaPaySecretKeyFromEnv).mockResolvedValue(undefined)
    vi.mocked(readSolvaPayProductRefFromEnv).mockResolvedValue(undefined)
    process.env.SOLVAPAY_API_BASE_URL = 'https://api-dev.solvapay.com'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 401, ok: false }))

    const report = await runDoctorInDirectory({
      cwd: TEST_CWD,
      options: { dev: true, apiBaseUrl: 'http://localhost:3010' },
    })

    expect(report.apiBaseUrl).toBe('http://localhost:3010')
  })

  it('throws when --api-base is not a parseable URL', async () => {
    await expect(
      runDoctorInDirectory({ cwd: TEST_CWD, options: { apiBaseUrl: 'not-a-url' } }),
    ).rejects.toThrow(/Invalid --api-base/)
  })
})
