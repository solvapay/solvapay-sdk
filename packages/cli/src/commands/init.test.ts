import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runInitCommand } from './init'

vi.mock('../lib/browser-auth', () => ({
  createInitSession: vi.fn(),
  openAuthUrl: vi.fn(),
  waitForExchange: vi.fn(),
  verifySecretKey: vi.fn(),
}))

vi.mock('../lib/env', () => ({
  writeSolvaPaySecretToEnv: vi.fn(),
  ensureEnvInGitignore: vi.fn(),
}))

vi.mock('../lib/install', () => ({
  getInstallCommand: vi.fn(),
  installSolvaPaySdk: vi.fn(),
}))

vi.mock('../lib/project', () => ({
  detectPackageManager: vi.fn(),
  ensureNodeProject: vi.fn(),
}))

import {
  createInitSession,
  openAuthUrl,
  verifySecretKey,
  waitForExchange,
} from '../lib/browser-auth'
import { ensureEnvInGitignore, writeSolvaPaySecretToEnv } from '../lib/env'
import { getInstallCommand, installSolvaPaySdk } from '../lib/install'
import { detectPackageManager, ensureNodeProject } from '../lib/project'

describe('runInitCommand', () => {
  const output: string[] = []

  beforeEach(() => {
    output.length = 0
    vi.restoreAllMocks()
    vi.mocked(ensureNodeProject).mockResolvedValue({
      filePath: '/tmp/project/package.json',
      action: 'existing',
    })
    vi.mocked(detectPackageManager).mockResolvedValue('npm')
    vi.mocked(ensureEnvInGitignore).mockResolvedValue({
      filePath: '/tmp/project/.gitignore',
      action: 'unchanged',
    })
    vi.mocked(installSolvaPaySdk).mockResolvedValue({
      ok: true,
      command: 'npm install @solvapay/server@latest @solvapay/core@latest',
    })
    vi.mocked(getInstallCommand).mockReturnValue(
      'npm install @solvapay/server@latest @solvapay/core@latest',
    )
    vi.spyOn(process.stdout, 'write').mockImplementation(chunk => {
      output.push(String(chunk))
      return true
    })
  })

  it('prints manual URL when browser fails to open', async () => {
    vi.mocked(createInitSession).mockResolvedValue({
      sessionId: 's1',
      authUrl: 'https://app.solvapay.com/auth/cli-init?session_id=s1',
      pollToken: 'poll',
    })
    vi.mocked(openAuthUrl).mockResolvedValue(false)
    vi.mocked(waitForExchange).mockResolvedValue({
      status: 'complete',
      secretKey: 'sk_live_123',
      email: 'dev@example.com',
    })
    vi.mocked(writeSolvaPaySecretToEnv).mockResolvedValue({
      filePath: '/tmp/.env',
      action: 'created',
    })
    vi.mocked(verifySecretKey).mockResolvedValue({ ok: true })

    await runInitCommand()

    expect(output.join('')).toContain('____        _            ____')
    expect(output.join('')).toContain('Detected npm project (package.json found)')
    expect(output.join('')).toContain("If it doesn't open, visit:")
    expect(output.join('')).toContain('✅ Secret key verified with SolvaPay')
    expect(output.join('')).toContain("You're all set! Here's how to get started:")
  })

  it('keeps success flow when verify fails', async () => {
    vi.mocked(createInitSession).mockResolvedValue({
      sessionId: 's1',
      authUrl: 'https://app.solvapay.com/auth/cli-init?session_id=s1',
      pollToken: 'poll',
    })
    vi.mocked(openAuthUrl).mockResolvedValue(true)
    vi.mocked(waitForExchange).mockResolvedValue({
      status: 'complete',
      secretKey: 'sk_live_123',
    })
    vi.mocked(writeSolvaPaySecretToEnv).mockResolvedValue({
      filePath: '/tmp/.env',
      action: 'created',
    })
    vi.mocked(verifySecretKey).mockResolvedValue({
      ok: false,
      warning: 'network unavailable',
    })

    await runInitCommand()

    expect(output.join('')).toContain('Verification failed, but setup can still continue')
  })

  it('continues when package install fails', async () => {
    vi.mocked(createInitSession).mockResolvedValue({
      sessionId: 's1',
      authUrl: 'https://app.solvapay.com/auth/cli-init?session_id=s1',
      pollToken: 'poll',
    })
    vi.mocked(openAuthUrl).mockResolvedValue(true)
    vi.mocked(waitForExchange).mockResolvedValue({
      status: 'complete',
      secretKey: 'sk_live_123',
    })
    vi.mocked(writeSolvaPaySecretToEnv).mockResolvedValue({
      filePath: '/tmp/.env',
      action: 'created',
    })
    vi.mocked(installSolvaPaySdk).mockResolvedValue({
      ok: false,
      command: 'npm install @solvapay/server@latest @solvapay/core@latest',
      warning: 'Installer exited with code 1',
    })
    vi.mocked(getInstallCommand).mockReturnValue(
      'npm install @solvapay/server@latest @solvapay/core@latest',
    )
    vi.mocked(verifySecretKey).mockResolvedValue({ ok: true })

    await runInitCommand()

    expect(output.join('')).toContain('Install failed')
    expect(output.join('')).toContain(
      'Run manually: npm install @solvapay/server@latest @solvapay/core@latest',
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

    await expect(runInitCommand()).rejects.toThrow('Timed out after 5 minutes')
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
    vi.mocked(createInitSession).mockResolvedValue({
      sessionId: 's1',
      authUrl: 'https://app.solvapay.com/auth/cli-init?session_id=s1',
      pollToken: 'poll',
    })
    vi.mocked(openAuthUrl).mockResolvedValue(true)
    vi.mocked(waitForExchange).mockResolvedValue({
      status: 'complete',
      secretKey: 'sk_live_123',
    })
    vi.mocked(writeSolvaPaySecretToEnv).mockResolvedValue({
      filePath: '/tmp/.env',
      action: 'created',
    })
    vi.mocked(verifySecretKey).mockResolvedValue({ ok: true })

    await runInitCommand()

    expect(output.join('')).toContain('Detected npm project (package.json created)')
  })
})
