import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { detectProject, parseLanguage } from './language'

describe('parseLanguage', () => {
  it('accepts the three languages and TypeScript aliases', () => {
    expect(parseLanguage('python')).toBe('python')
    expect(parseLanguage('Go')).toBe('go')
    expect(parseLanguage('typescript')).toBe('ts')
    expect(parseLanguage('ts')).toBe('ts')
  })

  it('throws on anything else', () => {
    expect(() => parseLanguage('ruby')).toThrow('Unknown --language "ruby"')
  })
})

describe('detectProject', () => {
  let cwd: string
  const write = (name: string, content = '') => writeFile(path.join(cwd, name), content, 'utf8')

  beforeEach(async () => {
    cwd = await mkdtemp(path.join(os.tmpdir(), 'detect-'))
  })

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true })
  })

  it('finds Go from go.mod', async () => {
    await write('go.mod', 'module example.com/x\n')
    await expect(detectProject(cwd, { interactive: false })).resolves.toEqual({
      language: 'go',
      manager: 'go',
    })
  })

  it.each([
    [['pyproject.toml', 'uv.lock'], 'uv'],
    [['pyproject.toml', 'poetry.lock'], 'poetry'],
    [['requirements.txt'], 'pip'],
    [['pyproject.toml'], 'pip'],
  ])('finds Python from %j with %s', async (files, manager) => {
    for (const file of files) await write(file)
    await expect(detectProject(cwd, { interactive: false })).resolves.toEqual({
      language: 'python',
      manager,
    })
  })

  it('reads [tool.poetry] from pyproject.toml without a lockfile', async () => {
    await write('pyproject.toml', '[tool.poetry]\nname = "x"\n')
    await expect(detectProject(cwd, { interactive: false })).resolves.toMatchObject({
      manager: 'poetry',
    })
  })

  it('finds TypeScript from package.json and its lockfile', async () => {
    await write('package.json', '{}')
    await write('pnpm-lock.yaml')
    await expect(detectProject(cwd, { interactive: false })).resolves.toEqual({
      language: 'ts',
      manager: 'pnpm',
      createdPackageJson: false,
    })
  })

  it('fails without a terminal when two languages are present', async () => {
    await write('package.json', '{}')
    await write('pyproject.toml')
    await expect(detectProject(cwd, { interactive: false })).rejects.toThrow(
      `Found package.json and pyproject.toml in ${cwd}. Pass --language ts|python.`,
    )
  })

  it('asks at a terminal when two languages are present', async () => {
    await write('package.json', '{}')
    await write('go.mod')
    const ask = vi.fn().mockResolvedValue('go')
    await expect(detectProject(cwd, { interactive: true, ask })).resolves.toEqual({
      language: 'go',
      manager: 'go',
    })
    expect(ask.mock.calls[0][1]).toEqual(['ts', 'go'])
  })

  it('uses --language over the markers', async () => {
    await write('package.json', '{}')
    await write('go.mod')
    await expect(detectProject(cwd, { interactive: false, language: 'ts' })).resolves.toMatchObject(
      { language: 'ts' },
    )
  })

  it('fails without a terminal in an empty folder and creates nothing', async () => {
    await expect(detectProject(cwd, { interactive: false })).rejects.toThrow(/Pass --language ts/)
    await expect(readFile(path.join(cwd, 'package.json'), 'utf8')).rejects.toThrow(/ENOENT/)
  })

  it('creates package.json in an empty folder only for --language ts', async () => {
    await expect(detectProject(cwd, { interactive: false, language: 'ts' })).resolves.toMatchObject(
      { language: 'ts', createdPackageJson: true },
    )
    expect(JSON.parse(await readFile(path.join(cwd, 'package.json'), 'utf8')).private).toBe(true)
  })

  it('tells Python and Go to create their project first', async () => {
    await expect(detectProject(cwd, { interactive: false, language: 'python' })).rejects.toThrow(
      /uv init && uv lock/,
    )
    await expect(detectProject(cwd, { interactive: false, language: 'go' })).rejects.toThrow(
      /go mod init/,
    )
  })

  it('asks for the language at a terminal in an empty folder', async () => {
    const ask = vi.fn().mockResolvedValue('ts')
    await expect(detectProject(cwd, { interactive: true, ask })).resolves.toMatchObject({
      language: 'ts',
      createdPackageJson: true,
    })
  })
})
