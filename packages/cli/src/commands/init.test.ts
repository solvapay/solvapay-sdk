import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runInitCommand } from './init'

vi.mock('@solvapay/init', () => ({
  runInitInDirectory: vi.fn(),
}))

import { runInitInDirectory } from '@solvapay/init'

describe('runInitCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('delegates to runInitInDirectory with process.cwd() and forwards options', async () => {
    vi.mocked(runInitInDirectory).mockResolvedValue()

    await runInitCommand({ yes: true })

    expect(runInitInDirectory).toHaveBeenCalledWith({
      cwd: process.cwd(),
      options: { yes: true },
    })
  })

  it('forwards --dev through to runInitInDirectory', async () => {
    vi.mocked(runInitInDirectory).mockResolvedValue()

    await runInitCommand({ yes: false, dev: true })

    expect(runInitInDirectory).toHaveBeenCalledWith({
      cwd: process.cwd(),
      options: { yes: false, dev: true },
    })
  })

  it('defaults options to {} when none are provided', async () => {
    vi.mocked(runInitInDirectory).mockResolvedValue()

    await runInitCommand()

    expect(runInitInDirectory).toHaveBeenCalledWith({
      cwd: process.cwd(),
      options: {},
    })
  })
})
