import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const installProjectDependencies = vi.fn()
const runInitInDirectory = vi.fn()

vi.mock('./scaffold', async importOriginal => ({
  ...(await importOriginal<typeof import('./scaffold')>()),
  installProjectDependencies,
}))
vi.mock('@solvapay/init', async importOriginal => ({
  ...(await importOriginal<typeof import('@solvapay/init')>()),
  runInitInDirectory,
}))

const { runFromScratch } = await import('./from-scratch')

describe('runFromScratch dependency install', () => {
  let parent: string

  beforeEach(async () => {
    parent = await mkdtemp(join(tmpdir(), 'create-solvapay-install-'))
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    installProjectDependencies.mockReset()
    runInitInDirectory.mockReset()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(parent, { recursive: true, force: true })
  })

  it('fails the scaffold and skips init when the install fails', async () => {
    installProjectDependencies.mockResolvedValue({
      ok: false,
      command: 'npm install',
      warning: 'npm error code ERESOLVE',
    })
    const target = join(parent, 'srv')

    await expect(
      runFromScratch({
        target,
        projectName: 'srv',
        toolName: 'get_quote',
        options: {},
        offline: true,
      }),
    ).rejects.toThrow(`\`npm install\` failed in ${target}: npm error code ERESOLVE`)
    expect(runInitInDirectory).not.toHaveBeenCalled()
  })
})
