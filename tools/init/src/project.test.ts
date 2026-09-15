import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { detectPackageManager, ensureNodeProject } from './project'

describe('ensureNodeProject', () => {
  const makeTempDir = async () => mkdtemp(path.join(os.tmpdir(), 'solvapay-init-'))

  it('returns existing when package.json is already present', async () => {
    const cwd = await makeTempDir()
    try {
      await writeFile(path.join(cwd, 'package.json'), '{"name":"demo"}\n', 'utf8')
      const result = await ensureNodeProject({ cwd })
      expect(result.action).toBe('existing')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('creates package.json when user confirms', async () => {
    const cwd = await makeTempDir()
    try {
      const result = await ensureNodeProject({
        cwd,
        confirmCreate: async () => true,
      })
      const packageJsonPath = path.join(cwd, 'package.json')
      const content = await readFile(packageJsonPath, 'utf8')

      expect(result.action).toBe('created')
      expect(content).toContain('"name"')
      expect(content).toContain('"version": "1.0.0"')
      expect(content).toContain('"private": true')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('returns cancelled when user declines package.json creation', async () => {
    const cwd = await makeTempDir()
    try {
      const result = await ensureNodeProject({
        cwd,
        confirmCreate: async () => false,
      })
      expect(result.action).toBe('cancelled')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })
})

describe('detectPackageManager', () => {
  const makeTempDir = async () => mkdtemp(path.join(os.tmpdir(), 'solvapay-init-'))

  it('detects pnpm from lockfile', async () => {
    const cwd = await makeTempDir()
    try {
      await writeFile(path.join(cwd, 'pnpm-lock.yaml'), '', 'utf8')
      await writeFile(path.join(cwd, 'package-lock.json'), '', 'utf8')
      const packageManager = await detectPackageManager(cwd)
      expect(packageManager).toBe('pnpm')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('falls back to package.json packageManager metadata', async () => {
    const cwd = await makeTempDir()
    try {
      await writeFile(path.join(cwd, 'package.json'), '{"packageManager":"yarn@4.0.0"}\n', 'utf8')
      const packageManager = await detectPackageManager(cwd)
      expect(packageManager).toBe('yarn')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('detects package manager from parent workspace root', async () => {
    const root = await makeTempDir()
    const nested = path.join(root, 'apps', 'api')
    try {
      await writeFile(path.join(root, 'pnpm-lock.yaml'), '', 'utf8')
      await writeFile(path.join(root, 'package.json'), '{"name":"workspace"}\n', 'utf8')
      await mkdir(nested, { recursive: true })
      await writeFile(path.join(nested, '.keep'), '', 'utf8')

      const packageManager = await detectPackageManager(nested)
      expect(packageManager).toBe('pnpm')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('defaults to npm when no signals are present', async () => {
    const cwd = await makeTempDir()
    try {
      const packageManager = await detectPackageManager(cwd)
      expect(packageManager).toBe('npm')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })
})
