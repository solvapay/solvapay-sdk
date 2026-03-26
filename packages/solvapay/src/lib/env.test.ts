import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { writeSolvaPaySecretToEnv } from './env'

describe('writeSolvaPaySecretToEnv', () => {
  const makeTempDir = async () => mkdtemp(path.join(os.tmpdir(), 'solvapay-init-'))

  it('creates .env when it does not exist', async () => {
    const cwd = await makeTempDir()
    try {
      const result = await writeSolvaPaySecretToEnv('sk_live_new', { cwd })
      const content = await readFile(path.join(cwd, '.env'), 'utf8')

      expect(result.action).toBe('created')
      expect(content).toBe('SOLVAPAY_SECRET_KEY=sk_live_new\n')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('appends key when .env exists without SolvaPay key', async () => {
    const cwd = await makeTempDir()
    try {
      await writeFile(path.join(cwd, '.env'), 'FOO=bar\n', 'utf8')
      const result = await writeSolvaPaySecretToEnv('sk_live_append', { cwd })
      const content = await readFile(path.join(cwd, '.env'), 'utf8')

      expect(result.action).toBe('appended')
      expect(content).toContain('FOO=bar\n')
      expect(content).toContain('SOLVAPAY_SECRET_KEY=sk_live_append\n')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('does not overwrite existing key when user declines', async () => {
    const cwd = await makeTempDir()
    try {
      await writeFile(path.join(cwd, '.env'), 'SOLVAPAY_SECRET_KEY=sk_live_old\n', 'utf8')
      const result = await writeSolvaPaySecretToEnv('sk_live_new', {
        cwd,
        confirmOverwrite: async () => false,
      })
      const content = await readFile(path.join(cwd, '.env'), 'utf8')

      expect(result.action).toBe('unchanged')
      expect(content).toBe('SOLVAPAY_SECRET_KEY=sk_live_old\n')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('overwrites existing key when user confirms', async () => {
    const cwd = await makeTempDir()
    try {
      await writeFile(path.join(cwd, '.env'), 'SOLVAPAY_SECRET_KEY=sk_live_old\nOTHER=1\n', 'utf8')
      const result = await writeSolvaPaySecretToEnv('sk_live_new', {
        cwd,
        confirmOverwrite: async () => true,
      })
      const content = await readFile(path.join(cwd, '.env'), 'utf8')

      expect(result.action).toBe('updated')
      expect(content).toContain('SOLVAPAY_SECRET_KEY=sk_live_new')
      expect(content).toContain('OTHER=1')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })
})
