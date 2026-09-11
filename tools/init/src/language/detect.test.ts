import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { detectProjectLanguage } from './detect'

const makeTempDir = (): Promise<string> => mkdtemp(path.join(os.tmpdir(), 'solvapay-lang-'))

describe('detectProjectLanguage', () => {
  it('returns none when no language manifest is present', async () => {
    const cwd = await makeTempDir()
    try {
      expect(await detectProjectLanguage(cwd)).toEqual({ status: 'none' })
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('detects TypeScript from package.json', async () => {
    const cwd = await makeTempDir()
    try {
      await writeFile(path.join(cwd, 'package.json'), '{}\n', 'utf8')
      expect(await detectProjectLanguage(cwd)).toEqual({ status: 'detected', language: 'ts' })
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('detects Python from pyproject.toml', async () => {
    const cwd = await makeTempDir()
    try {
      await writeFile(path.join(cwd, 'pyproject.toml'), '[project]\nname = "demo"\n', 'utf8')
      expect(await detectProjectLanguage(cwd)).toEqual({ status: 'detected', language: 'python' })
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('detects Ruby from Gemfile', async () => {
    const cwd = await makeTempDir()
    try {
      await writeFile(path.join(cwd, 'Gemfile'), 'source "https://rubygems.org"\n', 'utf8')
      expect(await detectProjectLanguage(cwd)).toEqual({ status: 'detected', language: 'ruby' })
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('detects Go from go.mod', async () => {
    const cwd = await makeTempDir()
    try {
      await writeFile(path.join(cwd, 'go.mod'), 'module example.com/demo\n', 'utf8')
      expect(await detectProjectLanguage(cwd)).toEqual({ status: 'detected', language: 'go' })
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('detects Rust from Cargo.toml', async () => {
    const cwd = await makeTempDir()
    try {
      await writeFile(path.join(cwd, 'Cargo.toml'), '[package]\nname = "demo"\n', 'utf8')
      expect(await detectProjectLanguage(cwd)).toEqual({ status: 'detected', language: 'rust' })
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('returns ambiguous when both go.mod and package.json exist', async () => {
    const cwd = await makeTempDir()
    try {
      await writeFile(path.join(cwd, 'go.mod'), 'module example.com/demo\n', 'utf8')
      await writeFile(path.join(cwd, 'package.json'), '{}\n', 'utf8')
      expect(await detectProjectLanguage(cwd)).toEqual({
        status: 'ambiguous',
        candidates: ['ts', 'go'],
      })
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })
})
