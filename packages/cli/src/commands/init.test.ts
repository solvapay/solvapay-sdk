import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runInitCommand } from './init'

vi.mock('../lib/browser-auth', () => ({
  createInitSession: vi.fn(),
  openAuthUrl: vi.fn(),
  waitForExchange: vi.fn(),
  verifySecretKey: vi.fn(),
  verifyProductRef: vi.fn(),
}))

vi.mock('../lib/env', () => ({
  writeSolvaPaySecretToEnv: vi.fn(),
  ensureEnvInGitignore: vi.fn(),
  readSolvaPayProductRefFromEnv: vi.fn(),
  writeSolvaPayProductRefToEnv: vi.fn(),
  SOLVAPAY_PRODUCT_REF_PLACEHOLDER: '__SOLVAPAY_PRODUCT_REF__',
}))

vi.mock('../lib/product-picker', () => ({
  pickProductInteractive: vi.fn(),
  askKeepConfiguredProduct: vi.fn(),
  formatConfiguredProductLabel: vi.fn(),
}))

vi.mock('../lib/products', () => ({
  listProducts: vi.fn(),
}))

vi.mock('../lib/install', () => ({
  getInstallCommand: vi.fn(),
  getSolvaPayBasePackages: vi.fn(),
  installSolvaPaySdk: vi.fn(),
}))

vi.mock('../lib/project', () => ({
  detectPackageManager: vi.fn(),
  ensureNodeProject: vi.fn(),
  waitForEnter: vi.fn(),
}))

import {
  createInitSession,
  openAuthUrl,
  verifyProductRef,
  verifySecretKey,
  waitForExchange,
} from '../lib/browser-auth'
import {
  ensureEnvInGitignore,
  readSolvaPayProductRefFromEnv,
  writeSolvaPayProductRefToEnv,
  writeSolvaPaySecretToEnv,
} from '../lib/env'
import {
  askKeepConfiguredProduct,
  formatConfiguredProductLabel,
  pickProductInteractive,
} from '../lib/product-picker'
import { listProducts } from '../lib/products'
import { getInstallCommand, getSolvaPayBasePackages, installSolvaPaySdk } from '../lib/install'
import { detectPackageManager, ensureNodeProject, waitForEnter } from '../lib/project'

const mockProduct = {
  reference: 'prd_newest',
  name: 'Newest Product',
  status: 'active',
  createdAt: '2026-01-02T00:00:00.000Z',
}

const mockSecondProduct = {
  reference: 'prd_second',
  name: 'Second Product',
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
}

describe('runInitCommand', () => {
  const output: string[] = []

  const mockSuccessfulAuth = () => {
    vi.mocked(createInitSession).mockResolvedValue({
      sessionId: 's1',
      authUrl: 'https://app.solvapay.com/auth/cli-init?session_id=s1',
      pollToken: 'poll',
    })
    vi.mocked(openAuthUrl).mockResolvedValue(true)
    vi.mocked(waitForExchange).mockResolvedValue({
      status: 'complete',
      secretKey: 'sk_test_123',
      email: 'dev@example.com',
    })
    vi.mocked(writeSolvaPaySecretToEnv).mockResolvedValue({
      filePath: '/tmp/.env',
      action: 'created',
    })
    vi.mocked(verifySecretKey).mockResolvedValue({ ok: true })
  }

  beforeEach(() => {
    output.length = 0
    vi.clearAllMocks()
    vi.restoreAllMocks()
    vi.mocked(ensureNodeProject).mockResolvedValue({
      filePath: '/tmp/project/package.json',
      action: 'existing',
    })
    vi.mocked(detectPackageManager).mockResolvedValue('npm')
    vi.mocked(waitForEnter).mockResolvedValue()
    vi.mocked(ensureEnvInGitignore).mockResolvedValue({
      filePath: '/tmp/project/.gitignore',
      action: 'unchanged',
    })
    vi.mocked(installSolvaPaySdk).mockResolvedValue({
      ok: true,
      command: 'npm install @solvapay/server@latest @solvapay/core@latest @solvapay/auth@latest',
    })
    vi.mocked(getSolvaPayBasePackages).mockReturnValue([
      '@solvapay/server',
      '@solvapay/core',
      '@solvapay/auth',
    ])
    vi.mocked(getInstallCommand).mockResolvedValue(
      'npm install @solvapay/server@latest @solvapay/core@latest @solvapay/auth@latest',
    )
    vi.mocked(readSolvaPayProductRefFromEnv).mockResolvedValue(undefined)
    vi.mocked(formatConfiguredProductLabel).mockImplementation(
      (productRef, products) =>
        products.find(product => product.reference === productRef)?.name
          ? `${products.find(product => product.reference === productRef)?.name} (${productRef})`
          : productRef,
    )
    vi.spyOn(process.stdout, 'write').mockImplementation(chunk => {
      output.push(String(chunk))
      return true
    })
  })

  it('prints manual URL when browser fails to open', async () => {
    mockSuccessfulAuth()
    vi.mocked(openAuthUrl).mockResolvedValue(false)
    vi.mocked(pickProductInteractive).mockResolvedValue({ action: 'skipped', reason: 'zero_products' })

    await runInitCommand()

    expect(output.join('')).toContain('____        _            ____')
    expect(output.join('')).toContain('Detected npm project (package.json found)')
    expect(output.join('')).toContain('Browser authentication URL:')
    expect(output.join('')).toContain("If it doesn't open, visit:")
    expect(output.join('')).toContain('✅ Secret key verified with SolvaPay')
    expect(output.join('')).toContain("You're all set! Here's how to get started:")
    expect(waitForEnter).toHaveBeenCalledWith(
      'Press Enter to open your browser to authenticate and set up your account if you do not already have one. ',
    )
    const waitForEnterCallOrder = vi.mocked(waitForEnter).mock.invocationCallOrder[0]
    const openAuthCallOrder = vi.mocked(openAuthUrl).mock.invocationCallOrder[0]
    expect(waitForEnterCallOrder).toBeLessThan(openAuthCallOrder)
  })

  it('keeps success flow when verify fails', async () => {
    mockSuccessfulAuth()
    vi.mocked(verifySecretKey).mockResolvedValue({
      ok: false,
      warning: 'network unavailable',
    })
    vi.mocked(pickProductInteractive).mockResolvedValue({ action: 'skipped', reason: 'network_error' })

    await runInitCommand()

    expect(output.join('')).toContain('Verification failed, but setup can still continue')
  })

  it('continues when package install fails', async () => {
    mockSuccessfulAuth()
    vi.mocked(installSolvaPaySdk).mockResolvedValue({
      ok: false,
      command: 'npm install @solvapay/server@latest @solvapay/core@latest @solvapay/auth@latest',
      warning: 'Installer exited with code 1',
    })
    vi.mocked(pickProductInteractive).mockResolvedValue({ action: 'skipped', reason: 'zero_products' })

    await runInitCommand()

    expect(output.join('')).toContain('Install failed')
    expect(output.join('')).toContain(
      'Run manually: npm install @solvapay/server@latest @solvapay/core@latest @solvapay/auth@latest',
    )
  })

  it('throws when browser auth times out', async () => {
    vi.mocked(createInitSession).mockResolvedValue({
      sessionId: 's1',
      authUrl: 'https://app.solvapay.com/auth/cli-init?session_id=s1',
      pollToken: 'poll',
    })
    vi.mocked(openAuthUrl).mockResolvedValue(true)
    vi.mocked(waitForExchange).mockResolvedValue({
      status: 'expired',
    })

    await expect(runInitCommand()).rejects.toThrow('Timed out after 10 minutes')
  })

  it('exits cleanly when package.json is missing and user declines creation', async () => {
    vi.mocked(ensureNodeProject).mockResolvedValue({
      filePath: '/tmp/project/package.json',
      action: 'cancelled',
    })

    await runInitCommand()

    expect(output.join('')).toContain('Initialization cancelled')
    expect(createInitSession).not.toHaveBeenCalled()
  })

  it('prints created package.json message when project is bootstrapped', async () => {
    vi.mocked(ensureNodeProject).mockResolvedValue({
      filePath: '/tmp/project/package.json',
      action: 'created',
    })
    mockSuccessfulAuth()
    vi.mocked(pickProductInteractive).mockResolvedValue({ action: 'skipped', reason: 'zero_products' })

    await runInitCommand()

    expect(output.join('')).toContain('Detected npm project (package.json created)')
  })

  it('skips enter confirmation when yes option is enabled', async () => {
    mockSuccessfulAuth()
    vi.mocked(pickProductInteractive).mockResolvedValue({
      action: 'picked',
      product: mockProduct,
    })
    vi.mocked(writeSolvaPayProductRefToEnv).mockResolvedValue({
      filePath: '/tmp/.env',
      action: 'updated',
    })

    await runInitCommand({ yes: true })

    expect(ensureNodeProject).toHaveBeenCalledWith({ autoCreate: true })
    expect(waitForEnter).not.toHaveBeenCalled()
    expect(openAuthUrl).toHaveBeenCalledWith('https://app.solvapay.com/auth/cli-init?session_id=s1')
  })

  it('keeps an existing verified product when the user confirms keep', async () => {
    mockSuccessfulAuth()
    vi.mocked(readSolvaPayProductRefFromEnv).mockResolvedValue('prd_REAL')
    vi.mocked(verifyProductRef).mockResolvedValue({ status: 'ok' })
    vi.mocked(listProducts).mockResolvedValue({
      ok: true,
      products: [{ ...mockProduct, reference: 'prd_REAL', name: 'Real Product' }],
      total: 1,
    })
    vi.mocked(askKeepConfiguredProduct).mockResolvedValue(true)

    await runInitCommand()

    expect(askKeepConfiguredProduct).toHaveBeenCalled()
    expect(pickProductInteractive).not.toHaveBeenCalled()
    expect(writeSolvaPayProductRefToEnv).not.toHaveBeenCalled()
    expect(output.join('')).toContain('✅ Product ref verified (prd_REAL)')
  })

  it('runs the picker when the user declines to keep the existing product', async () => {
    mockSuccessfulAuth()
    vi.mocked(readSolvaPayProductRefFromEnv).mockResolvedValue('prd_REAL')
    vi.mocked(verifyProductRef).mockResolvedValue({ status: 'ok' })
    vi.mocked(listProducts).mockResolvedValue({
      ok: true,
      products: [{ ...mockProduct, reference: 'prd_REAL', name: 'Real Product' }],
      total: 1,
    })
    vi.mocked(askKeepConfiguredProduct).mockResolvedValue(false)
    vi.mocked(pickProductInteractive).mockResolvedValue({
      action: 'picked',
      product: mockSecondProduct,
    })
    vi.mocked(writeSolvaPayProductRefToEnv).mockResolvedValue({
      filePath: '/tmp/.env',
      action: 'updated',
    })

    await runInitCommand()

    expect(pickProductInteractive).toHaveBeenCalled()
    expect(writeSolvaPayProductRefToEnv).toHaveBeenCalledWith('prd_second', { cwd: process.cwd() })
    expect(output.join('')).toContain('Product configured: Second Product (prd_second)')
  })

  it('runs the picker when the existing product ref is not found', async () => {
    mockSuccessfulAuth()
    vi.mocked(readSolvaPayProductRefFromEnv).mockResolvedValue('prd_fake')
    vi.mocked(verifyProductRef).mockResolvedValue({
      status: 'not_found',
      body: 'not found',
    })
    vi.mocked(pickProductInteractive).mockResolvedValue({
      action: 'picked',
      product: mockProduct,
    })
    vi.mocked(writeSolvaPayProductRefToEnv).mockResolvedValue({
      filePath: '/tmp/.env',
      action: 'updated',
    })

    await runInitCommand()

    expect(pickProductInteractive).toHaveBeenCalled()
    expect(writeSolvaPayProductRefToEnv).toHaveBeenCalledWith('prd_newest', { cwd: process.cwd() })
  })

  it('runs the picker when the product ref is still the scaffold placeholder', async () => {
    mockSuccessfulAuth()
    vi.mocked(readSolvaPayProductRefFromEnv).mockResolvedValue('__SOLVAPAY_PRODUCT_REF__')
    vi.mocked(pickProductInteractive).mockResolvedValue({
      action: 'picked',
      product: mockProduct,
    })
    vi.mocked(writeSolvaPayProductRefToEnv).mockResolvedValue({
      filePath: '/tmp/.env',
      action: 'updated',
    })

    await runInitCommand()

    expect(verifyProductRef).not.toHaveBeenCalled()
    expect(pickProductInteractive).toHaveBeenCalled()
    expect(writeSolvaPayProductRefToEnv).toHaveBeenCalledWith('prd_newest', { cwd: process.cwd() })
  })

  it('auto-picks a product under --yes when no existing ref is configured', async () => {
    mockSuccessfulAuth()
    vi.mocked(pickProductInteractive).mockResolvedValue({
      action: 'picked',
      product: mockProduct,
    })
    vi.mocked(writeSolvaPayProductRefToEnv).mockResolvedValue({
      filePath: '/tmp/.env',
      action: 'created',
    })

    await runInitCommand({ yes: true })

    expect(pickProductInteractive).toHaveBeenCalledWith(
      'https://api.solvapay.com',
      'sk_test_123',
      { yes: true },
    )
    expect(writeSolvaPayProductRefToEnv).toHaveBeenCalledWith('prd_newest', { cwd: process.cwd() })
  })

  it('skips product configuration when the picker finds zero products', async () => {
    mockSuccessfulAuth()
    vi.mocked(pickProductInteractive).mockResolvedValue({
      action: 'skipped',
      reason: 'zero_products',
    })

    await runInitCommand()

    expect(writeSolvaPayProductRefToEnv).not.toHaveBeenCalled()
    expect(output.join('')).toContain("You're all set! Here's how to get started:")
  })

  it('skips product configuration when listing products fails', async () => {
    mockSuccessfulAuth()
    vi.mocked(pickProductInteractive).mockResolvedValue({
      action: 'skipped',
      reason: 'network_error',
    })

    await runInitCommand()

    expect(writeSolvaPayProductRefToEnv).not.toHaveBeenCalled()
    expect(output.join('')).toContain("You're all set! Here's how to get started:")
  })

  it('writes nothing when the user declines a single-product prompt', async () => {
    mockSuccessfulAuth()
    vi.mocked(pickProductInteractive).mockResolvedValue({ action: 'declined' })

    await runInitCommand()

    expect(writeSolvaPayProductRefToEnv).not.toHaveBeenCalled()
    expect(output.join('')).toContain('Skipped — set SOLVAPAY_PRODUCT_REF in .env later.')
  })
})
