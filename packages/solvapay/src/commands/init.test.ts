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
}))

import {
  createInitSession,
  openAuthUrl,
  verifySecretKey,
  waitForExchange,
} from '../lib/browser-auth'
import { writeSolvaPaySecretToEnv } from '../lib/env'

describe('runInitCommand', () => {
  const output: string[] = []

  beforeEach(() => {
    output.length = 0
    vi.restoreAllMocks()
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

    expect(output.join('')).toContain('Open this URL to sign in:')
    expect(output.join('')).toContain('✓ Connected to SolvaPay')
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

    expect(output.join('')).toContain('Key written, but verification failed')
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
})
