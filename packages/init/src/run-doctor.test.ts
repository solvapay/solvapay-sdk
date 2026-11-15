import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runDoctorInDirectory } from './run-doctor'

vi.mock('./browser-auth', () => ({
  verifySecretKey: vi.fn(),
  verifyProductRef: vi.fn(),
}))

vi.mock('./env', () => ({
  readSolvaPaySecretKeyFromEnv: vi.fn(),
  readSolvaPayApiBaseUrlFromEnv: vi.fn(),
  readSolvaPayProductRefFromEnv: vi.fn(),
  SOLVAPAY_PRODUCT_REF_PLACEHOLDER: '__SOLVAPAY_PRODUCT_REF__',
}))

import { verifyProductRef, verifySecretKey } from './browser-auth'
import {
  readSolvaPayApiBaseUrlFromEnv,
  readSolvaPayProductRefFromEnv,
  readSolvaPaySecretKeyFromEnv,
} from './env'

const TEST_CWD = '/tmp/doctor-project'

describe('runDoctorInDirectory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.SOLVAPAY_SECRET_KEY
    delete process.env.SOLVAPAY_PRODUCT_REF
    delete process.env.SOLVAPAY_API_BASE_URL
    delete process.env.SOLVAPAY_DEBUG
    vi.mocked(readSolvaPayApiBaseUrlFromEnv).mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fails when the secret key is missing', async () => {
    vi.mocked(readSolvaPaySecretKeyFromEnv).mockResolvedValue(undefined)
    vi.mocked(readSolvaPayProductRefFromEnv).mockResolvedValue(undefined)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ status: 401, ok: false }),
    )

    const report = await runDoctorInDirectory({ cwd: TEST_CWD })

    expect(report.ok).toBe(false)
    expect(report.checks.find(c => c.name === 'SOLVAPAY_SECRET_KEY')?.ok).toBe(false)
  })

  it('passes when secret, product, readiness and the SDK version are good', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'doctor-good-'))
    await writeFile(
      path.join(cwd, 'go.mod'),
      'module x\n\nrequire github.com/solvapay/solvapay-sdk/go v0.1.0\n',
    )
    vi.mocked(readSolvaPaySecretKeyFromEnv).mockResolvedValue('sk_test')
    vi.mocked(readSolvaPayProductRefFromEnv).mockResolvedValue('prd_ready')
    vi.mocked(verifySecretKey).mockResolvedValue({ ok: true })
    vi.mocked(verifyProductRef).mockResolvedValue({
      status: 'ok',
      product: {
        name: 'Ready Product',
        status: 'active',
        plans: [{ isActive: true }],
      },
    })

    const report = await runDoctorInDirectory({ cwd, sdkVersions: async () => ['v0.1.0'] })
    await rm(cwd, { recursive: true, force: true })

    expect(report.checks.filter(c => !c.ok)).toEqual([])
    expect(report.ok).toBe(true)
    expect(report.checks.find(c => c.name === 'Product readiness')?.ok).toBe(true)
  })

  it('fails when no SolvaPay SDK is found in any language', async () => {
    vi.mocked(readSolvaPaySecretKeyFromEnv).mockResolvedValue(undefined)
    vi.mocked(readSolvaPayProductRefFromEnv).mockResolvedValue(undefined)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 401, ok: false }))

    const report = await runDoctorInDirectory({ cwd: TEST_CWD })
    const check = report.checks.find(c => c.name === 'SolvaPay SDK')

    expect(check?.ok).toBe(false)
    expect(check?.detail).toContain('no SolvaPay SDK found')
  })

  it('fails when the product has no active plans', async () => {
    vi.mocked(readSolvaPaySecretKeyFromEnv).mockResolvedValue('sk_test')
    vi.mocked(readSolvaPayProductRefFromEnv).mockResolvedValue('prd_empty')
    vi.mocked(verifySecretKey).mockResolvedValue({ ok: true })
    vi.mocked(verifyProductRef).mockResolvedValue({
      status: 'ok',
      product: {
        name: 'Empty',
        status: 'active',
        plans: [],
      },
    })

    const report = await runDoctorInDirectory({ cwd: TEST_CWD })

    expect(report.ok).toBe(false)
    expect(report.checks.find(c => c.name === 'Product readiness')?.ok).toBe(false)
  })

  it('fails the @solvapay/* versions check when an installed package is behind npm', async () => {
    const { mkdir, mkdtemp, rm, writeFile } = await import('node:fs/promises')
    const os = await import('node:os')
    const path = await import('node:path')
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'doctor-outdated-'))
    try {
      await writeFile(path.join(cwd, 'package.json'), JSON.stringify({ dependencies: { '@solvapay/mcp': '^0.4.3' } }))
      await mkdir(path.join(cwd, 'node_modules', '@solvapay', 'mcp'), { recursive: true })
      await writeFile(
        path.join(cwd, 'node_modules', '@solvapay', 'mcp', 'package.json'),
        JSON.stringify({ name: '@solvapay/mcp', version: '0.4.3' }),
      )
      vi.mocked(readSolvaPaySecretKeyFromEnv).mockResolvedValue(undefined)
      vi.mocked(readSolvaPayProductRefFromEnv).mockResolvedValue(undefined)
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 401, ok: false }))

      const report = await runDoctorInDirectory({ cwd, distTags: async () => ({ latest: '0.5.0' }) })
      const check = report.checks.find(c => c.name === '@solvapay/* versions')

      expect(check?.ok).toBe(false)
      expect(check?.detail).toContain('@solvapay/mcp 0.4.3 (npm latest 0.5.0)')
      expect(check?.detail).toContain('install --save-exact @solvapay/mcp@0.5.0')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('targets api-dev when --dev is set', async () => {
    vi.mocked(readSolvaPaySecretKeyFromEnv).mockResolvedValue(undefined)
    vi.mocked(readSolvaPayProductRefFromEnv).mockResolvedValue(undefined)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ status: 401, ok: false }),
    )

    const report = await runDoctorInDirectory({ cwd: TEST_CWD, options: { dev: true } })

    expect(report.apiBaseUrl).toBe('https://api-dev.solvapay.com')
  })

  describe('Python and Go SDK versions', () => {
    let cwd: string
    const write = (name: string, content: string) => writeFile(path.join(cwd, name), content)
    const run = (versions: string[]) =>
      runDoctorInDirectory({ cwd, sdkVersions: async () => versions })
    const sdkCheck = (report: Awaited<ReturnType<typeof run>>, name: string) =>
      report.checks.find(c => c.name === name)

    beforeEach(async () => {
      cwd = await mkdtemp(path.join(os.tmpdir(), 'doctor-lang-'))
      vi.mocked(readSolvaPaySecretKeyFromEnv).mockResolvedValue(undefined)
      vi.mocked(readSolvaPayProductRefFromEnv).mockResolvedValue(undefined)
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 401, ok: false }))
    })

    afterEach(async () => {
      await rm(cwd, { recursive: true, force: true })
    })

    const uvLock = (version: string, source = '{ registry = "https://pypi.org/simple" }') =>
      `version = 1\n\n[[package]]\nname = "httpx"\nversion = "0.28.1"\n\n[[package]]\nname = "solvapay"\nversion = "${version}"\nsource = ${source}\n`

    it('passes a uv.lock on the newest stable release', async () => {
      await write('pyproject.toml', 'dependencies = ["solvapay[mcp]==0.1.1"]\n')
      await write('uv.lock', uvLock('0.1.1'))
      const check = sdkCheck(
        await run(['0.1.0', '0.1.1', '0.2.0.dev1']),
        'solvapay (Python) version',
      )
      expect(check).toEqual({
        name: 'solvapay (Python) version',
        ok: true,
        detail: '0.1.1 (uv.lock) is the newest release',
      })
    })

    it('fails a stale preview and prints the uv command with its extras', async () => {
      await write('pyproject.toml', 'dependencies = ["solvapay[mcp]==0.1.0.dev4"]\n')
      await write('uv.lock', uvLock('0.1.0.dev4'))
      const check = sdkCheck(await run(['0.1.0.dev4', '0.1.0.dev12']), 'solvapay (Python) version')
      expect(check?.ok).toBe(false)
      expect(check?.detail).toBe(
        "0.1.0.dev4 (uv.lock) is behind the newest preview 0.1.0.dev12. Upgrade with: uv add 'solvapay[mcp]==0.1.0.dev12'",
      )
    })

    it('reads poetry.lock', async () => {
      await write('pyproject.toml', '[tool.poetry.dependencies]\nsolvapay = "0.1.0"\n')
      await write('poetry.lock', '[[package]]\nname = "solvapay"\nversion = "0.1.0"\n')
      const check = sdkCheck(await run(['0.1.0', '0.1.2']), 'solvapay (Python) version')
      expect(check?.detail).toContain("poetry add 'solvapay==0.1.2'")
    })

    it('reads an exact pin in requirements.txt', async () => {
      await write('requirements.txt', 'uvicorn>=0.32\nsolvapay[mcp]==0.1.2  # pinned\n')
      const check = sdkCheck(await run(['0.1.2']), 'solvapay (Python) version')
      expect(check?.ok).toBe(true)
    })

    it('fails an unpinned requirements.txt line', async () => {
      await write('requirements.txt', 'solvapay>=0.1\n')
      const check = sdkCheck(await run(['0.1.2']), 'solvapay (Python) version')
      expect(check?.ok).toBe(false)
      expect(check?.detail).toContain('without an exact version')
    })

    it('fails pyproject.toml with solvapay and no lockfile', async () => {
      await write('pyproject.toml', '[project]\ndependencies = ["solvapay>=0.1,<0.2"]\n')
      const check = sdkCheck(await run(['0.1.2']), 'solvapay (Python) version')
      expect(check?.ok).toBe(false)
      expect(check?.detail).toContain('Run `uv lock`')
    })

    it('fails a uv.lock that installs solvapay from a local path', async () => {
      await write('pyproject.toml', 'dependencies = ["solvapay"]\n')
      await write('uv.lock', uvLock('0.0.0', '{ editable = "../../python" }'))
      const check = sdkCheck(await run(['0.1.2']), 'solvapay (Python) version')
      expect(check?.ok).toBe(false)
      expect(check?.detail).toContain('local path or git')
    })

    it('checks go.mod against the Go proxy', async () => {
      await write(
        'go.mod',
        'module x\n\ngo 1.26\n\nrequire (\n\tgithub.com/solvapay/solvapay-sdk/go v0.1.0-dev.7\n)\n',
      )
      const check = sdkCheck(await run(['v0.1.0-dev.7', 'v0.1.0-dev.9']), 'solvapay-sdk/go version')
      expect(check?.ok).toBe(false)
      expect(check?.detail).toBe(
        'v0.1.0-dev.7 (go.mod) is behind the newest preview v0.1.0-dev.9. Upgrade with: go get github.com/solvapay/solvapay-sdk/go@v0.1.0-dev.9 && go mod tidy',
      )
    })

    it('fails a go.mod that replaces the SDK with a local directory', async () => {
      await write(
        'go.mod',
        'module x\n\nrequire github.com/solvapay/solvapay-sdk/go v0.0.0\n\nreplace github.com/solvapay/solvapay-sdk/go => ../../go\n',
      )
      const check = sdkCheck(await run(['v0.1.0']), 'solvapay-sdk/go version')
      expect(check?.ok).toBe(false)
      expect(check?.detail).toContain('replaces github.com/solvapay/solvapay-sdk/go with ../../go')
    })

    it('does not report a missing SDK when only Go uses it', async () => {
      await write('package.json', '{"dependencies":{"react":"19"}}')
      await write('go.mod', 'module x\n\nrequire github.com/solvapay/solvapay-sdk/go v0.1.0\n')
      const report = await run(['v0.1.0'])
      expect(report.checks.find(c => c.name === 'SolvaPay SDK')).toBeUndefined()
      expect(sdkCheck(report, 'solvapay-sdk/go version')?.ok).toBe(true)
    })
  })
})
