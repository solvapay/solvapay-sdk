import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runInitInDirectory } from './run-init'

// We only mock the network-dependent and PM-dependent edges; the env
// writers (env.ts) and product helpers run against the real temp `cwd`
// so we can verify `cwd` threads through to disk writes.

vi.mock('./browser-auth', () => ({
  createInitSession: vi.fn(),
  openAuthUrl: vi.fn(),
  waitForExchange: vi.fn(),
  verifySecretKey: vi.fn(),
  verifyProductRef: vi.fn(),
  verifyMerchant: vi.fn(),
}))

vi.mock('./install', () => ({
  installSolvaPaySdk: vi.fn(),
  getInstallCommand: vi.fn(),
  getSolvaPayBasePackages: vi.fn(),
}))

vi.mock('./products', () => ({
  listProducts: vi.fn(),
}))

vi.mock('./product-picker', () => ({
  pickProductInteractive: vi.fn(),
  askKeepConfiguredProduct: vi.fn(),
  formatConfiguredProductLabel: vi.fn(),
}))

vi.mock('./project', async () => {
  // Keep the real detectPackageManager / ensureNodeProject so they touch
  // the test cwd, but stub waitForEnter (no TTY in test).
  const actual = await vi.importActual<typeof import('./project')>('./project')
  return {
    ...actual,
    waitForEnter: vi.fn().mockResolvedValue(undefined),
  }
})

import {
  createInitSession,
  openAuthUrl,
  verifyMerchant,
  verifySecretKey,
  waitForExchange,
} from './browser-auth'
import { getInstallCommand, getSolvaPayBasePackages, installSolvaPaySdk } from './install'
import { pickProductInteractive } from './product-picker'

describe('runInitInDirectory (integration)', () => {
  let cwd: string

  beforeEach(async () => {
    cwd = await mkdtemp(path.join(os.tmpdir(), 'init-int-'))
    vi.clearAllMocks()
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    vi.mocked(createInitSession).mockResolvedValue({
      sessionId: 's1',
      authUrl: 'https://app.solvapay.com/auth/cli-init?session_id=s1',
      pollToken: 'poll',
    })
    vi.mocked(openAuthUrl).mockResolvedValue(true)
    vi.mocked(waitForExchange).mockResolvedValue({
      status: 'complete',
      secretKey: 'sk_test_integration',
      email: 'dev@example.com',
    })
    vi.mocked(verifySecretKey).mockResolvedValue({ ok: true })
    vi.mocked(verifyMerchant).mockResolvedValue({ status: 'ok' })
    vi.mocked(installSolvaPaySdk).mockResolvedValue({
      ok: true,
      command: 'npm install ...',
    })
    vi.mocked(getInstallCommand).mockResolvedValue('npm install ...')
    vi.mocked(getSolvaPayBasePackages).mockReturnValue([
      '@solvapay/server',
      '@solvapay/core',
      '@solvapay/auth',
    ])
    vi.mocked(pickProductInteractive).mockResolvedValue({
      action: 'skipped',
      reason: 'zero_products',
    })
  })

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('writes SOLVAPAY_SECRET_KEY into the target cwd, not process.cwd()', async () => {
    await writeFile(path.join(cwd, 'package.json'), '{"name":"target","version":"0.0.0"}\n', 'utf8')

    await runInitInDirectory({ cwd, options: { yes: true } })

    const envContent = await readFile(path.join(cwd, '.env'), 'utf8')
    expect(envContent).toContain('SOLVAPAY_SECRET_KEY=sk_test_integration')

    const gitignoreContent = await readFile(path.join(cwd, '.gitignore'), 'utf8')
    expect(gitignoreContent).toContain('.env')
  })

  it('creates package.json in the target cwd when missing under --yes', async () => {
    await runInitInDirectory({ cwd, options: { yes: true } })

    const pkg = JSON.parse(await readFile(path.join(cwd, 'package.json'), 'utf8'))
    expect(pkg.version).toBe('1.0.0')
    expect(pkg.private).toBe(true)
  })

  it('respects skipSdkInstall: true and never invokes installSolvaPaySdk', async () => {
    await writeFile(path.join(cwd, 'package.json'), '{"name":"target","version":"0.0.0"}\n', 'utf8')

    await runInitInDirectory({ cwd, options: { yes: true }, skipSdkInstall: true })

    expect(installSolvaPaySdk).not.toHaveBeenCalled()
  })
})
