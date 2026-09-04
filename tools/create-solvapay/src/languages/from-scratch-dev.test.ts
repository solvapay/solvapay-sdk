import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { findSolvapaySdkRoot } from '../types/mcp/from-scratch'

describe('findSolvapaySdkRoot', () => {
  it('finds the monorepo from a nested create-solvapay path', async () => {
    const root = await findSolvapaySdkRoot(path.join(process.cwd(), 'templates', 'mcp', 'python'))
    expect(root).toBeTruthy()
    expect(root?.endsWith('solvapay-sdk')).toBe(true)
  })

  it('returns undefined outside the monorepo', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'not-sdk-'))
    try {
      await mkdir(path.join(cwd, 'nested'), { recursive: true })
      await writeFile(path.join(cwd, 'nested', 'file.txt'), 'x', 'utf8')
      expect(await findSolvapaySdkRoot(path.join(cwd, 'nested'))).toBeUndefined()
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })
})
