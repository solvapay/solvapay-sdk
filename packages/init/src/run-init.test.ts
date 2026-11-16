import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runInitInDirectory } from './run-init'

vi.mock('./browser-auth', () => ({
  createInitSession: vi.fn(),
  openAuthUrl: vi.fn(),
  waitForExchange: vi.fn(),
  verifySecretKey: vi.fn(),
  verifyProductRef: vi.fn(),
  verifyMerchant: vi.fn(),
}))

vi.mock('./env', () => ({
  writeSolvaPaySecretToEnv: vi.fn(),
  ensureEnvInGitignore: vi.fn(),
  readSolvaPayProductRefFromEnv: vi.fn(),
  writeSolvaPayProductRefToEnv: vi.fn(),
  writeMcpServerEnvDefaults: vi.fn(),
  SOLVAPAY_PRODUCT_REF_PLACEHOLDER: '__SOLVAPAY_PRODUCT_REF__',
}))

vi.mock('./python-mcp', async () => {
  const actual = await vi.importActual<typeof import('./python-mcp')>('./python-mcp')
  return { ...actual, inspectPythonMcpProject: vi.fn() }
})

vi.mock('./product-picker', () => ({
  pickProductInteractive: vi.fn(),
  askKeepConfiguredProduct: vi.fn(),
  formatConfiguredProductLabel: vi.fn(),
}))

vi.mock('./products', () => ({
  listProducts: vi.fn(),
}))

vi.mock('./install', async () => {
  const actual = await vi.importActual<typeof import('./install')>('./install')
  return {
    ...actual,
    getInstallCommand: vi.fn(),
    getSolvaPayBasePackages: vi.fn(),
    installSolvaPaySdk: vi.fn(),
    runSdkCommand: vi.fn(),
  }
})

vi.mock('./project', () => ({
  waitForEnter: vi.fn(),
}))

vi.mock('./language', async () => {
  const actual = await vi.importActual<typeof import('./language')>('./language')
  return { ...actual, detectProject: vi.fn() }
})

import {
  createInitSession,
  openAuthUrl,
  verifyMerchant,
  verifyProductRef,
  verifySecretKey,
  waitForExchange,
} from './browser-auth'
import {
  ensureEnvInGitignore,
  readSolvaPayProductRefFromEnv,
  writeMcpServerEnvDefaults,
  writeSolvaPayProductRefToEnv,
  writeSolvaPaySecretToEnv,
} from './env'
import { inspectPythonMcpProject, type PythonMcpProject } from './python-mcp'
import {
  getInstallCommand,
  getSolvaPayBasePackages,
  installSolvaPaySdk,
  runSdkCommand,
} from './install'
import {
  askKeepConfiguredProduct,
  formatConfiguredProductLabel,
  pickProductInteractive,
} from './product-picker'
import { listProducts } from './products'
import { detectProject } from './language'
import { waitForEnter } from './project'

const TEST_CWD = '/tmp/project'

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

describe('runInitInDirectory', () => {
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
    vi.mocked(verifyMerchant).mockResolvedValue({ status: 'ok' })
  }

  beforeEach(() => {
    output.length = 0
    vi.clearAllMocks()
    vi.restoreAllMocks()
    vi.mocked(detectProject).mockResolvedValue({
      language: 'ts',
      manager: 'npm',
      createdPackageJson: false,
    })
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

  it('warns when the exchanged key is live and still writes it', async () => {
    mockSuccessfulAuth()
    vi.mocked(waitForExchange).mockResolvedValue({
      status: 'complete',
      secretKey: 'sk_live_123',
      email: 'dev@example.com',
      environment: 'live',
    })
    vi.mocked(pickProductInteractive).mockResolvedValue({ action: 'skipped', reason: 'zero_products' })

    await runInitInDirectory({ cwd: TEST_CWD })

    const text = output.join('')
    expect(text).toContain('LIVE key. Real charges apply.')
    expect(text).toContain('Switch the Console to sandbox')
    expect(writeSolvaPaySecretToEnv).toHaveBeenCalledWith('sk_live_123', { cwd: TEST_CWD })
  })

  it('overwrites an existing key without prompting when --yes is set', async () => {
    mockSuccessfulAuth()
    vi.mocked(pickProductInteractive).mockResolvedValue({ action: 'skipped', reason: 'zero_products' })

    await runInitInDirectory({ cwd: TEST_CWD, options: { yes: true } })

    const options = vi.mocked(writeSolvaPaySecretToEnv).mock.calls[0]?.[1]
    expect(options?.cwd).toBe(TEST_CWD)
    await expect(options?.confirmOverwrite?.()).resolves.toBe(true)
  })

  it('threads cwd through detectProject and env writes', async () => {
    mockSuccessfulAuth()
    vi.mocked(pickProductInteractive).mockResolvedValue({ action: 'skipped', reason: 'zero_products' })

    await runInitInDirectory({ cwd: TEST_CWD, interactive: true })

    expect(detectProject).toHaveBeenCalledWith(TEST_CWD, { language: undefined, interactive: true })
    expect(writeSolvaPaySecretToEnv).toHaveBeenCalledWith('sk_test_123', { cwd: TEST_CWD })
    expect(ensureEnvInGitignore).toHaveBeenCalledWith(TEST_CWD)
  })

  it('prints manual URL when browser fails to open', async () => {
    mockSuccessfulAuth()
    vi.mocked(openAuthUrl).mockResolvedValue(false)
    vi.mocked(pickProductInteractive).mockResolvedValue({ action: 'skipped', reason: 'zero_products' })

    await runInitInDirectory({ cwd: TEST_CWD })

    expect(output.join('')).toContain('____        _            ____')
    expect(output.join('')).toContain('Detected npm project (package.json found)')
    expect(output.join('')).toContain('Browser authentication URL:')
    expect(output.join('')).toContain("If it doesn't open, visit:")
    expect(output.join('')).toContain('✅ Secret key authenticates')
    expect(output.join('')).toContain("You're all set. SolvaPay credentials were saved to .env.")
    expect(waitForEnter).toHaveBeenCalledWith(
      'Press Enter to open your browser to authenticate and set up your account if you do not already have one. ',
    )
    const waitForEnterCallOrder = vi.mocked(waitForEnter).mock.invocationCallOrder[0]
    const openAuthCallOrder = vi.mocked(openAuthUrl).mock.invocationCallOrder[0]
    expect(waitForEnterCallOrder).toBeLessThan(openAuthCallOrder)
  })

  it('runs verifyMerchant before .env write and SDK install', async () => {
    mockSuccessfulAuth()
    vi.mocked(verifyMerchant).mockResolvedValue({ status: 'not_found' })

    await expect(runInitInDirectory({ cwd: TEST_CWD })).rejects.toThrow(/Provider account not found/i)

    // Hard-fail must skip the destructive setup steps — the project
    // should be untouched when the merchant probe fails.
    expect(writeSolvaPaySecretToEnv).not.toHaveBeenCalled()
    expect(ensureEnvInGitignore).not.toHaveBeenCalled()
    expect(installSolvaPaySdk).not.toHaveBeenCalled()
  })

  it('keeps success flow when verify fails', async () => {
    mockSuccessfulAuth()
    vi.mocked(verifySecretKey).mockResolvedValue({
      ok: false,
      warning: 'network unavailable',
    })
    vi.mocked(pickProductInteractive).mockResolvedValue({ action: 'skipped', reason: 'network_error' })

    await runInitInDirectory({ cwd: TEST_CWD })

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

    await runInitInDirectory({ cwd: TEST_CWD })

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

    await expect(runInitInDirectory({ cwd: TEST_CWD })).rejects.toThrow(
      'Timed out after 10 minutes',
    )
  })

  it('stops before sign-in when the project cannot be detected', async () => {
    vi.mocked(detectProject).mockRejectedValue(new Error('Pass --language ts|python|go.'))

    await expect(runInitInDirectory({ cwd: TEST_CWD })).rejects.toThrow('Pass --language')
    expect(createInitSession).not.toHaveBeenCalled()
  })

  it('prints created package.json message when project is bootstrapped', async () => {
    vi.mocked(detectProject).mockResolvedValue({
      language: 'ts',
      manager: 'npm',
      createdPackageJson: true,
    })
    mockSuccessfulAuth()
    vi.mocked(pickProductInteractive).mockResolvedValue({ action: 'skipped', reason: 'zero_products' })

    await runInitInDirectory({ cwd: TEST_CWD })

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

    await runInitInDirectory({ cwd: TEST_CWD, options: { yes: true } })

    expect(detectProject).toHaveBeenCalledWith(TEST_CWD, {
      language: undefined,
      interactive: false,
    })
    expect(waitForEnter).not.toHaveBeenCalled()
    expect(openAuthUrl).toHaveBeenCalledWith('https://app.solvapay.com/auth/cli-init?session_id=s1')
  })

  it('keeps an existing verified product when the user confirms keep', async () => {
    mockSuccessfulAuth()
    vi.mocked(readSolvaPayProductRefFromEnv).mockResolvedValue('prd_REAL')
    vi.mocked(verifyProductRef).mockResolvedValue({
      status: 'ok',
      product: { name: 'Newest Product', status: 'active', plans: [{ isActive: true }] },
    })
    vi.mocked(listProducts).mockResolvedValue({
      ok: true,
      products: [{ ...mockProduct, reference: 'prd_REAL', name: 'Real Product' }],
      total: 1,
    })
    vi.mocked(askKeepConfiguredProduct).mockResolvedValue(true)

    await runInitInDirectory({ cwd: TEST_CWD })

    expect(askKeepConfiguredProduct).toHaveBeenCalled()
    expect(pickProductInteractive).not.toHaveBeenCalled()
    expect(writeSolvaPayProductRefToEnv).not.toHaveBeenCalled()
    expect(output.join('')).toContain('✅ Product ref verified (prd_REAL)')
  })

  it('runs the picker when the user declines to keep the existing product', async () => {
    mockSuccessfulAuth()
    vi.mocked(readSolvaPayProductRefFromEnv).mockResolvedValue('prd_REAL')
    vi.mocked(verifyProductRef).mockResolvedValue({
      status: 'ok',
      product: { name: 'Newest Product', status: 'active', plans: [{ isActive: true }] },
    })
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

    await runInitInDirectory({ cwd: TEST_CWD })

    expect(pickProductInteractive).toHaveBeenCalled()
    expect(writeSolvaPayProductRefToEnv).toHaveBeenCalledWith('prd_second', { cwd: TEST_CWD })
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

    await runInitInDirectory({ cwd: TEST_CWD })

    expect(pickProductInteractive).toHaveBeenCalled()
    expect(writeSolvaPayProductRefToEnv).toHaveBeenCalledWith('prd_newest', { cwd: TEST_CWD })
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

    await runInitInDirectory({ cwd: TEST_CWD })

    expect(verifyProductRef).not.toHaveBeenCalled()
    expect(pickProductInteractive).toHaveBeenCalled()
    expect(writeSolvaPayProductRefToEnv).toHaveBeenCalledWith('prd_newest', { cwd: TEST_CWD })
  })

  it('does not auto-pick or hard-fail under --yes when no product ref is configured', async () => {
    mockSuccessfulAuth()
    vi.mocked(pickProductInteractive).mockResolvedValue({
      action: 'skipped',
      reason: 'non_interactive_requires_product',
    })

    await runInitInDirectory({ cwd: TEST_CWD, options: { yes: true } })

    expect(pickProductInteractive).toHaveBeenCalledWith(
      'https://api.solvapay.com',
      'sk_test_123',
      { yes: true },
    )
    expect(writeSolvaPayProductRefToEnv).not.toHaveBeenCalled()
  })

  it('verifies and writes an explicit productRef option without running the picker', async () => {
    mockSuccessfulAuth()
    vi.mocked(verifyProductRef).mockResolvedValue({
      status: 'ok',
      product: { name: 'Newest Product', status: 'active', plans: [{ isActive: true }] },
    })
    vi.mocked(writeSolvaPayProductRefToEnv).mockResolvedValue({
      filePath: '/tmp/.env',
      action: 'updated',
    })

    await runInitInDirectory({ cwd: TEST_CWD, options: { yes: true, productRef: 'prd_intended' } })

    expect(verifyProductRef).toHaveBeenCalledWith(
      'https://api.solvapay.com',
      'sk_test_123',
      'prd_intended',
    )
    expect(writeSolvaPayProductRefToEnv).toHaveBeenCalledWith('prd_intended', { cwd: TEST_CWD })
    expect(pickProductInteractive).not.toHaveBeenCalled()
    expect(output.join('')).toContain('Product ref verified (prd_intended)')
  })

  it('skips product configuration when the picker finds zero products', async () => {
    mockSuccessfulAuth()
    vi.mocked(pickProductInteractive).mockResolvedValue({
      action: 'skipped',
      reason: 'zero_products',
    })

    await runInitInDirectory({ cwd: TEST_CWD })

    expect(writeSolvaPayProductRefToEnv).not.toHaveBeenCalled()
    expect(output.join('')).toContain("You're all set. SolvaPay credentials were saved to .env.")
  })

  it('skips product configuration when listing products fails', async () => {
    mockSuccessfulAuth()
    vi.mocked(pickProductInteractive).mockResolvedValue({
      action: 'skipped',
      reason: 'network_error',
    })

    await runInitInDirectory({ cwd: TEST_CWD })

    expect(writeSolvaPayProductRefToEnv).not.toHaveBeenCalled()
    expect(output.join('')).toContain("You're all set. SolvaPay credentials were saved to .env.")
  })

  it('writes nothing when the user declines a single-product prompt', async () => {
    mockSuccessfulAuth()
    vi.mocked(pickProductInteractive).mockResolvedValue({ action: 'declined' })

    await runInitInDirectory({ cwd: TEST_CWD })

    expect(writeSolvaPayProductRefToEnv).not.toHaveBeenCalled()
    expect(output.join('')).toContain('Skipped — set SOLVAPAY_PRODUCT_REF in .env later.')
  })

  it('skips installSolvaPaySdk when skipSdkInstall is true', async () => {
    mockSuccessfulAuth()
    vi.mocked(pickProductInteractive).mockResolvedValue({ action: 'skipped', reason: 'zero_products' })

    await runInitInDirectory({ cwd: TEST_CWD, skipSdkInstall: true })

    expect(installSolvaPaySdk).not.toHaveBeenCalled()
    expect(output.join('')).not.toContain('SolvaPay SDK packages installed')
    expect(output.join('')).toContain("You're all set. SolvaPay credentials were saved to .env.")
  })

  it('hard-fails when verifyMerchant returns not_found', async () => {
    mockSuccessfulAuth()
    vi.mocked(verifyMerchant).mockResolvedValue({ status: 'not_found' })

    await expect(runInitInDirectory({ cwd: TEST_CWD })).rejects.toThrow(
      /Provider account not found/i,
    )

    // Product picker must not run after a hard-fail.
    expect(pickProductInteractive).not.toHaveBeenCalled()
    // The hard-fail message names the recovery path.
    const text = output.join('')
    expect(text).toMatch(/Provider account not found/i)
  })

  it('names the environment in the not_found message when the backend reports it', async () => {
    mockSuccessfulAuth()
    vi.mocked(waitForExchange).mockResolvedValue({
      status: 'complete',
      secretKey: 'sk_live_123',
      email: 'dev@example.com',
      environment: 'live',
    })
    vi.mocked(verifyMerchant).mockResolvedValue({
      status: 'not_found',
      environment: 'live',
      providerExistsInSandbox: true,
    })

    await expect(runInitInDirectory({ cwd: TEST_CWD })).rejects.toThrow(
      /Provider account not found in the live environment/i,
    )

    const text = output.join('')
    expect(text).toMatch(/Provider account not found in the live environment/i)
    expect(text).toMatch(/sandbox account exists/i)
    expect(text).toMatch(/Switch to live in the SolvaPay/i)
  })

  it('falls back to the exchange environment when the backend body omits it', async () => {
    mockSuccessfulAuth()
    vi.mocked(waitForExchange).mockResolvedValue({
      status: 'complete',
      secretKey: 'sk_live_123',
      email: 'dev@example.com',
      environment: 'live',
    })
    vi.mocked(verifyMerchant).mockResolvedValue({ status: 'not_found' })

    await expect(runInitInDirectory({ cwd: TEST_CWD })).rejects.toThrow(
      /Provider account not found in the live environment/i,
    )
  })

  it('hard-fails when verifyMerchant reports an env_mismatch', async () => {
    mockSuccessfulAuth()
    vi.mocked(verifyMerchant).mockResolvedValue({
      status: 'env_mismatch',
      keyEnvironment: 'live',
      providerEnvironment: 'sandbox',
    })

    await expect(runInitInDirectory({ cwd: TEST_CWD })).rejects.toThrow(
      /Secret key environment .* does not match the provider environment/i,
    )

    expect(writeSolvaPaySecretToEnv).not.toHaveBeenCalled()
    expect(pickProductInteractive).not.toHaveBeenCalled()
  })

  it('soft-warns and continues when verifyMerchant returns unauthorized', async () => {
    mockSuccessfulAuth()
    vi.mocked(verifyMerchant).mockResolvedValue({ status: 'unauthorized' })
    vi.mocked(pickProductInteractive).mockResolvedValue({
      action: 'skipped',
      reason: 'zero_products',
    })

    await runInitInDirectory({ cwd: TEST_CWD })

    expect(output.join('')).toMatch(/Merchant lookup unauthorized/i)
    expect(output.join('')).toContain("You're all set. SolvaPay credentials were saved to .env.")
  })

  it('soft-warns and continues when verifyMerchant returns a network error', async () => {
    mockSuccessfulAuth()
    vi.mocked(verifyMerchant).mockResolvedValue({
      status: 'error',
      message: 'network unavailable',
    })
    vi.mocked(pickProductInteractive).mockResolvedValue({
      action: 'skipped',
      reason: 'zero_products',
    })

    await runInitInDirectory({ cwd: TEST_CWD })

    expect(output.join('')).toMatch(/Merchant lookup failed/i)
    expect(output.join('')).toContain("You're all set. SolvaPay credentials were saved to .env.")
  })

  describe('Python and Go projects', () => {
    const versions = (python: string[], go: string[]) => async (language: 'python' | 'go') =>
      language === 'python' ? python : go

    const cleanPythonProject: PythonMcpProject = {
      mcp: { version: '2.3.0', source: 'uv.lock' },
      mcpCaps: [],
      fastapiMcp: [],
      fastmcp: [],
      solvapayMcpExtra: false,
      imports: [],
    }

    beforeEach(() => {
      mockSuccessfulAuth()
      vi.mocked(inspectPythonMcpProject).mockResolvedValue(cleanPythonProject)
      vi.mocked(writeMcpServerEnvDefaults).mockResolvedValue(['PUBLIC_BASE_URL', 'PORT'])
      vi.mocked(pickProductInteractive).mockResolvedValue({
        action: 'skipped',
        reason: 'zero_products',
      })
      vi.mocked(runSdkCommand).mockImplementation(async command => ({
        ok: true,
        command: [command.cmd, ...command.args].join(' '),
      }))
    })

    it('pins the newest stable Python SDK with uv and never touches npm', async () => {
      vi.mocked(detectProject).mockResolvedValue({ language: 'python', manager: 'uv' })

      await runInitInDirectory({
        cwd: TEST_CWD,
        options: { yes: true, features: ['mcp'] },
        sdkVersions: versions(['0.1.0', '0.2.0.dev3', '0.1.1'], []),
      })

      expect(installSolvaPaySdk).not.toHaveBeenCalled()
      expect(runSdkCommand).toHaveBeenCalledWith(
        { cmd: 'uv', args: ['add', 'solvapay[mcp]==0.1.1'] },
        TEST_CWD,
      )
      const text = output.join('')
      expect(text).toContain('Detected Python project (uv)')
      expect(text).toContain('reads environment variables, not .env')
      expect(text).toContain('PUBLIC_BASE_URL and PORT added to .env')
      expect(text).toContain('https://docs.solvapay.com/sdks/python/guides/mcp')
      expect(text).toContain('npx -y solvapay@latest verify <server url>/mcp')
      expect(text).toContain('npx -y solvapay@latest doctor')
      expect(writeMcpServerEnvDefaults).toHaveBeenCalledWith({ cwd: TEST_CWD })
    })

    it('stops before sign-in when the project locks mcp 1.x', async () => {
      vi.mocked(detectProject).mockResolvedValue({ language: 'python', manager: 'uv' })
      vi.mocked(inspectPythonMcpProject).mockResolvedValue({
        ...cleanPythonProject,
        mcp: { version: '1.30.0', source: 'uv.lock' },
        imports: [{ file: 'server.py', line: 1, module: 'mcp.server.fastmcp' }],
      })

      const run = runInitInDirectory({
        cwd: TEST_CWD,
        options: { yes: true, features: ['mcp'] },
        sdkVersions: versions(['0.1.0'], []),
      })

      await expect(run).rejects.toThrow(/uv\.lock locks mcp 1\.30\.0/)
      await expect(run).rejects.toThrow(
        /server\.py:1 imports mcp\.server\.fastmcp, which mcp 2\.0 removed/,
      )
      await expect(run).rejects.toThrow(/py\.sdk\.modelcontextprotocol\.io\/v2\/migration/)
      expect(createInitSession).not.toHaveBeenCalled()
      expect(writeSolvaPaySecretToEnv).not.toHaveBeenCalled()
      expect(runSdkCommand).not.toHaveBeenCalled()
    })

    it('stops before sign-in on fastapi-mcp', async () => {
      vi.mocked(detectProject).mockResolvedValue({ language: 'python', manager: 'uv' })
      vi.mocked(inspectPythonMcpProject).mockResolvedValue({
        ...cleanPythonProject,
        fastapiMcp: ['pyproject.toml', 'uv.lock'],
      })

      await expect(
        runInitInDirectory({
          cwd: TEST_CWD,
          options: { yes: true, features: ['mcp'] },
          sdkVersions: versions(['0.1.0'], []),
        }),
      ).rejects.toThrow(/pyproject\.toml and uv\.lock list fastapi-mcp, which runs only on mcp 1\.x/)
      expect(createInitSession).not.toHaveBeenCalled()
    })

    it('warns on fastmcp and carries on', async () => {
      vi.mocked(detectProject).mockResolvedValue({ language: 'python', manager: 'uv' })
      vi.mocked(inspectPythonMcpProject).mockResolvedValue({
        ...cleanPythonProject,
        fastmcp: ['pyproject.toml'],
        imports: [{ file: 'server.py', line: 3, module: 'fastmcp' }],
      })

      await runInitInDirectory({
        cwd: TEST_CWD,
        options: { yes: true, features: ['mcp'] },
        sdkVersions: versions(['0.1.0'], []),
      })

      expect(output.join('')).toContain(
        'This project uses fastmcp (pyproject.toml, server.py:3). SolvaPay has no fastmcp adapter',
      )
      expect(runSdkCommand).toHaveBeenCalled()
    })

    it('does not inspect mcp without --features mcp', async () => {
      vi.mocked(detectProject).mockResolvedValue({ language: 'python', manager: 'uv' })

      await runInitInDirectory({
        cwd: TEST_CWD,
        options: { yes: true },
        sdkVersions: versions(['0.1.0'], []),
      })

      expect(inspectPythonMcpProject).not.toHaveBeenCalled()
      expect(writeMcpServerEnvDefaults).not.toHaveBeenCalled()
      const text = output.join('')
      expect(text).toContain('https://docs.solvapay.com/sdks/python/setup/quick-start')
      expect(text).not.toContain('verify <server url>')
    })

    it('saves the product before the SDK install, so a failed install leaves .env complete', async () => {
      vi.mocked(detectProject).mockResolvedValue({ language: 'python', manager: 'uv' })
      vi.mocked(pickProductInteractive).mockResolvedValue({ action: 'picked', product: mockProduct })
      vi.mocked(writeSolvaPayProductRefToEnv).mockResolvedValue({
        filePath: '/tmp/project/.env',
        action: 'appended',
      })
      vi.mocked(runSdkCommand).mockResolvedValue({
        ok: false,
        command: "uv add 'solvapay[mcp]==0.1.0'",
        warning: 'exited with code 1',
      })

      await expect(
        runInitInDirectory({
          cwd: TEST_CWD,
          options: { yes: true, features: ['mcp'] },
          sdkVersions: versions(['0.1.0'], []),
        }),
      ).rejects.toThrow(/\.env is already complete/)
      expect(writeSolvaPayProductRefToEnv).toHaveBeenCalledWith('prd_newest', { cwd: TEST_CWD })
      expect(writeMcpServerEnvDefaults).toHaveBeenCalled()
      expect(vi.mocked(writeSolvaPayProductRefToEnv).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(runSdkCommand).mock.invocationCallOrder[0],
      )
    })

    it('fails before sign-in when only previews exist and the CLI is stable', async () => {
      vi.mocked(detectProject).mockResolvedValue({ language: 'python', manager: 'uv' })

      await expect(
        runInitInDirectory({
          cwd: TEST_CWD,
          options: { yes: true },
          sdkVersions: versions(['0.1.0.dev4', '0.1.0.dev12'], []),
        }),
      ).rejects.toThrow(
        /no stable release on PyPI yet \(newest preview: 0\.1\.0\.dev12\)\. Until a stable release is out, use the preview CLI/,
      )
      expect(createInitSession).not.toHaveBeenCalled()
    })

    it('pins the newest preview from a preview CLI', async () => {
      vi.mocked(detectProject).mockResolvedValue({ language: 'python', manager: 'poetry' })

      await runInitInDirectory({
        cwd: TEST_CWD,
        options: { yes: true, preview: true },
        sdkVersions: versions(['0.1.0.dev4', '0.1.0.dev12', '0.1.0.dev5'], []),
      })

      expect(runSdkCommand).toHaveBeenCalledWith(
        { cmd: 'poetry', args: ['add', 'solvapay==0.1.0.dev12'] },
        TEST_CWD,
      )
      expect(output.join('')).toContain('Preview SDK: 0.1.0.dev12')
    })

    it('prints the pip command instead of running it', async () => {
      vi.mocked(detectProject).mockResolvedValue({ language: 'python', manager: 'pip' })

      await runInitInDirectory({
        cwd: TEST_CWD,
        options: { yes: true, features: ['mcp', 'agents'] },
        sdkVersions: versions(['0.1.0'], []),
      })

      expect(runSdkCommand).not.toHaveBeenCalled()
      expect(output.join('')).toContain("python -m pip install 'solvapay[mcp,agents]==0.1.0'")
    })

    it('runs go get for a Go module', async () => {
      vi.mocked(detectProject).mockResolvedValue({ language: 'go', manager: 'go' })

      await runInitInDirectory({
        cwd: TEST_CWD,
        options: { yes: true, preview: true },
        sdkVersions: versions([], ['v0.1.0-dev.1', 'v0.1.0-dev.7', 'v0.1.0-dev.10']),
      })

      expect(runSdkCommand).toHaveBeenCalledWith(
        { cmd: 'go', args: ['get', 'github.com/solvapay/solvapay-sdk/go@v0.1.0-dev.10'] },
        TEST_CWD,
      )
      expect(installSolvaPaySdk).not.toHaveBeenCalled()
      expect(output.join('')).toContain('npx -y solvapay@preview doctor')
    })

    it('writes the server settings and links the Go MCP guide with --features mcp', async () => {
      vi.mocked(detectProject).mockResolvedValue({ language: 'go', manager: 'go' })

      await runInitInDirectory({
        cwd: TEST_CWD,
        options: { yes: true, features: ['mcp'] },
        sdkVersions: versions([], ['v0.1.0']),
      })

      expect(inspectPythonMcpProject).not.toHaveBeenCalled()
      expect(writeMcpServerEnvDefaults).toHaveBeenCalledWith({ cwd: TEST_CWD })
      expect(output.join('')).toContain('https://docs.solvapay.com/sdks/go/guides/mcp')
    })

    it('throws with the command when the install fails', async () => {
      vi.mocked(detectProject).mockResolvedValue({ language: 'go', manager: 'go' })
      vi.mocked(runSdkCommand).mockResolvedValue({
        ok: false,
        command: 'go get github.com/solvapay/solvapay-sdk/go@v0.1.0',
        warning: 'go is not installed or not on PATH',
      })

      await expect(
        runInitInDirectory({
          cwd: TEST_CWD,
          options: { yes: true },
          sdkVersions: versions([], ['v0.1.0']),
        }),
      ).rejects.toThrow(/go get .* failed: go is not installed/)
    })

    it('installs the npm preview tag for TypeScript from a preview CLI', async () => {
      await runInitInDirectory({
        cwd: TEST_CWD,
        options: { yes: true, preview: true, features: ['mcp'] },
      })

      expect(installSolvaPaySdk).toHaveBeenCalledWith('npm', TEST_CWD, expect.any(Function), {
        distTag: 'preview',
        features: ['mcp'],
      })
    })
  })
})
