import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ensureEnvInGitignore,
  readSolvaPayProductRefFromEnv,
  writeSolvaPayApiBaseUrlToEnv,
  writeSolvaPayProductRefToEnv,
  writeSolvaPaySecretToEnv,
} from './env'

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

describe('ensureEnvInGitignore', () => {
  const makeTempDir = async () => mkdtemp(path.join(os.tmpdir(), 'solvapay-init-'))

  it('creates .gitignore with .env when file is missing', async () => {
    const cwd = await makeTempDir()
    try {
      const result = await ensureEnvInGitignore(cwd)
      const content = await readFile(path.join(cwd, '.gitignore'), 'utf8')

      expect(result.action).toBe('created')
      expect(content).toBe('.env\n')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('appends .env when not present', async () => {
    const cwd = await makeTempDir()
    try {
      await writeFile(path.join(cwd, '.gitignore'), 'node_modules\n', 'utf8')
      const result = await ensureEnvInGitignore(cwd)
      const content = await readFile(path.join(cwd, '.gitignore'), 'utf8')

      expect(result.action).toBe('appended')
      expect(content).toContain('node_modules\n')
      expect(content).toContain('.env\n')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('keeps existing file unchanged when .env is already ignored', async () => {
    const cwd = await makeTempDir()
    try {
      await writeFile(path.join(cwd, '.gitignore'), 'node_modules\n.env\n', 'utf8')
      const result = await ensureEnvInGitignore(cwd)
      const content = await readFile(path.join(cwd, '.gitignore'), 'utf8')

      expect(result.action).toBe('unchanged')
      expect(content).toBe('node_modules\n.env\n')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })
})

describe('readSolvaPayProductRefFromEnv', () => {
  const makeTempDir = async () => mkdtemp(path.join(os.tmpdir(), 'solvapay-init-'))

  it('reads quoted and unquoted product ref from .env', async () => {
    const cwd = await makeTempDir()
    try {
      await writeFile(
        path.join(cwd, '.env'),
        'SOLVAPAY_PRODUCT_REF="prd_QUOTED"\nSOLVAPAY_SECRET_KEY=sk_test\n',
        'utf8',
      )
      const quoted = await readSolvaPayProductRefFromEnv(cwd)
      expect(quoted).toBe('prd_QUOTED')

      await writeFile(path.join(cwd, '.env'), 'SOLVAPAY_PRODUCT_REF=prd_plain\n', 'utf8')
      const plain = await readSolvaPayProductRefFromEnv(cwd)
      expect(plain).toBe('prd_plain')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('returns undefined when product ref is missing from .env', async () => {
    const cwd = await makeTempDir()
    try {
      await writeFile(path.join(cwd, '.env'), 'SOLVAPAY_SECRET_KEY=sk_test\n', 'utf8')
      const value = await readSolvaPayProductRefFromEnv(cwd)
      expect(value).toBeUndefined()
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })
})

describe('writeSolvaPayProductRefToEnv', () => {
  const makeTempDir = async () => mkdtemp(path.join(os.tmpdir(), 'solvapay-init-'))

  it('creates .env when it does not exist', async () => {
    const cwd = await makeTempDir()
    try {
      const result = await writeSolvaPayProductRefToEnv('prd_new', { cwd })
      const content = await readFile(path.join(cwd, '.env'), 'utf8')

      expect(result.action).toBe('created')
      expect(content).toBe('SOLVAPAY_PRODUCT_REF=prd_new\n')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('replaces the scaffold placeholder without prompting', async () => {
    const cwd = await makeTempDir()
    try {
      await writeFile(
        path.join(cwd, '.env'),
        'SOLVAPAY_PRODUCT_REF=__SOLVAPAY_PRODUCT_REF__\nSOLVAPAY_SECRET_KEY=sk_test\n',
        'utf8',
      )
      const result = await writeSolvaPayProductRefToEnv('prd_real', { cwd })
      const content = await readFile(path.join(cwd, '.env'), 'utf8')

      expect(result.action).toBe('updated')
      expect(content).toContain('SOLVAPAY_PRODUCT_REF=prd_real')
      expect(content).toContain('SOLVAPAY_SECRET_KEY=sk_test')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('replaces an existing real product ref', async () => {
    const cwd = await makeTempDir()
    try {
      await writeFile(path.join(cwd, '.env'), 'SOLVAPAY_PRODUCT_REF=prd_old\n', 'utf8')
      const result = await writeSolvaPayProductRefToEnv('prd_new', { cwd })
      const content = await readFile(path.join(cwd, '.env'), 'utf8')

      expect(result.action).toBe('updated')
      expect(content).toBe('SOLVAPAY_PRODUCT_REF=prd_new\n')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })
})

describe('writeSolvaPayApiBaseUrlToEnv', () => {
  const makeTempDir = async () => mkdtemp(path.join(os.tmpdir(), 'solvapay-init-'))
  const DEV_URL = 'https://api-dev.solvapay.com'
  const PROD_URL = 'https://api.solvapay.com'

  it('creates .env when it does not exist', async () => {
    const cwd = await makeTempDir()
    try {
      const result = await writeSolvaPayApiBaseUrlToEnv(DEV_URL, { cwd })
      const content = await readFile(path.join(cwd, '.env'), 'utf8')

      expect(result.action).toBe('created')
      expect(content).toBe(`SOLVAPAY_API_BASE_URL=${DEV_URL}\n`)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('appends the line when .env exists without the key', async () => {
    const cwd = await makeTempDir()
    try {
      await writeFile(path.join(cwd, '.env'), 'SOLVAPAY_SECRET_KEY=sk_test\n', 'utf8')
      const result = await writeSolvaPayApiBaseUrlToEnv(DEV_URL, { cwd })
      const content = await readFile(path.join(cwd, '.env'), 'utf8')

      expect(result.action).toBe('appended')
      expect(content).toContain('SOLVAPAY_SECRET_KEY=sk_test\n')
      expect(content).toContain(`SOLVAPAY_API_BASE_URL=${DEV_URL}\n`)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('replaces a commented placeholder line in place', async () => {
    const cwd = await makeTempDir()
    try {
      await writeFile(
        path.join(cwd, '.env'),
        'SOLVAPAY_SECRET_KEY=sk_test\n# SOLVAPAY_API_BASE_URL=https://api-staging.solvapay.com\n',
        'utf8',
      )
      const result = await writeSolvaPayApiBaseUrlToEnv(DEV_URL, { cwd })
      const content = await readFile(path.join(cwd, '.env'), 'utf8')

      expect(result.action).toBe('updated')
      expect(content).toContain(`SOLVAPAY_API_BASE_URL=${DEV_URL}\n`)
      expect(content).not.toContain('# SOLVAPAY_API_BASE_URL=')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('replaces an existing live value in place', async () => {
    const cwd = await makeTempDir()
    try {
      await writeFile(path.join(cwd, '.env'), `SOLVAPAY_API_BASE_URL=${PROD_URL}\n`, 'utf8')
      const result = await writeSolvaPayApiBaseUrlToEnv(DEV_URL, { cwd })
      const content = await readFile(path.join(cwd, '.env'), 'utf8')

      expect(result.action).toBe('updated')
      expect(content).toBe(`SOLVAPAY_API_BASE_URL=${DEV_URL}\n`)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('is a no-op when the value already matches', async () => {
    const cwd = await makeTempDir()
    try {
      await writeFile(path.join(cwd, '.env'), `SOLVAPAY_API_BASE_URL=${DEV_URL}\n`, 'utf8')
      const result = await writeSolvaPayApiBaseUrlToEnv(DEV_URL, { cwd })
      const content = await readFile(path.join(cwd, '.env'), 'utf8')

      expect(result.action).toBe('unchanged')
      expect(content).toBe(`SOLVAPAY_API_BASE_URL=${DEV_URL}\n`)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })
})
