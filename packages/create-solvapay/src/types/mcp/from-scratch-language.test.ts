import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertToolchain, runLanguageFromScratch } from './from-scratch-language'

const versions = async (language: 'python' | 'go') =>
  language === 'python' ? ['0.1.0.dev4', '0.1.0.dev12'] : ['v0.1.0-dev.1', 'v0.1.0-dev.7']

describe('runLanguageFromScratch', () => {
  let root: string
  let target: string
  const runCommand = vi.fn()
  const runInit = vi.fn()

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'cs-lang-'))
    target = path.join(root, 'quote-server')
    runCommand.mockReset().mockImplementation(async (command: { cmd: string; args: string[] }) => ({
      ok: true,
      command: [command.cmd, ...command.args].join(' '),
    }))
    runInit.mockReset().mockResolvedValue(undefined)
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(root, { recursive: true, force: true })
  })

  const scaffold = (language: 'python' | 'go', extra: Record<string, unknown> = {}) =>
    runLanguageFromScratch({
      target,
      projectName: 'quote-server',
      toolName: 'get_quote',
      language,
      options: { yes: true, preview: true },
      preview: true,
      skipInstall: false,
      sdkVersions: versions,
      runCommand,
      runInit,
      checkToolchain: async () => {},
      ...extra,
    })

  it('writes the Python template with the preview SDK pinned and runs uv sync then init', async () => {
    await scaffold('python', { skipInstall: true })

    const files = (await readdir(target)).sort()
    expect(files).toEqual(
      expect.arrayContaining([
        '.dockerignore',
        '.env',
        '.env.example',
        '.github',
        '.gitignore',
        'Dockerfile',
        'README.md',
        'pyproject.toml',
        'server.py',
        'tests',
        'tools.py',
      ]),
    )
    const pyproject = await readFile(path.join(target, 'pyproject.toml'), 'utf8')
    expect(pyproject).toContain('name = "quote-server"')
    expect(pyproject).toContain('"solvapay[mcp]==0.1.0.dev12"')
    const tools = await readFile(path.join(target, 'tools.py'), 'utf8')
    expect(tools).toContain('async def get_quote(')
    expect(tools).toContain('mcp.register_payable(\n        "get_quote"')
    expect(tools).not.toMatch(/__[A-Z_]+__/)
    const env = await readFile(path.join(target, '.env'), 'utf8')
    expect(env).toContain('PUBLIC_BASE_URL=http://localhost:8080')
    expect(env).toContain('PORT=8080')
    expect(runCommand).not.toHaveBeenCalled()
    expect(runInit).toHaveBeenCalledWith({
      cwd: target,
      options: { yes: true, preview: true, language: 'python' },
      skipSdkInstall: true,
    })
  })

  it('writes the Go template and runs go mod tidy', async () => {
    await scaffold('go')
    const goMod = await readFile(path.join(target, 'go.mod'), 'utf8')
    expect(goMod).toContain('module quote-server')
    expect(goMod).toContain('require github.com/solvapay/solvapay-sdk/go v0.1.0-dev.7')
    expect(runCommand).toHaveBeenCalledWith({ cmd: 'go', args: ['mod', 'tidy'] }, target)
    const main = await readFile(path.join(target, 'main.go'), 'utf8')
    expect(main).toContain('Name:          "quote-server"')
    expect(await readFile(path.join(target, 'tools.go'), 'utf8')).toContain(
      'RegisterPayable("get_quote"',
    )
  })

  it('fails before writing anything when only previews exist and the scaffolder is stable', async () => {
    await expect(scaffold('python', { preview: false })).rejects.toThrow(/use the preview CLI/)
    await expect(stat(target)).rejects.toThrow(/ENOENT/)
  })

  it('stops when the sync command fails', async () => {
    runCommand.mockResolvedValue({ ok: false, command: 'uv sync', warning: 'uv is not installed' })
    await expect(scaffold('python', { skipInstall: false })).rejects.toThrow(/uv/)
    expect(runInit).not.toHaveBeenCalled()
  })

  it('skips init with --skip-init', async () => {
    await scaffold('python', { skipInstall: true, skipInit: true })
    expect(runInit).not.toHaveBeenCalled()
  })
})

describe('assertToolchain', () => {
  it('accepts Go 1.26 and newer, and rejects older or missing Go', async () => {
    const probe =
      (output: string, ok = true) =>
      async () => ({ ok, output })
    await expect(
      assertToolchain('go', probe('go version go1.26.0 linux/amd64')),
    ).resolves.toBeUndefined()
    await expect(
      assertToolchain('go', probe('go version go1.27.4 darwin/arm64')),
    ).resolves.toBeUndefined()
    await expect(assertToolchain('go', probe('go version go1.25.3 linux/amd64'))).rejects.toThrow(
      'needs Go 1.26 or newer; found go1.25',
    )
    await expect(assertToolchain('go', probe('', false))).rejects.toThrow('Go is not installed')
  })

  it('needs uv for Python', async () => {
    await expect(
      assertToolchain('python', async () => ({ ok: false, output: '' })),
    ).rejects.toThrow('uses uv')
    await expect(
      assertToolchain('python', async () => ({ ok: true, output: 'uv 0.11.12' })),
    ).resolves.toBeUndefined()
  })
})
