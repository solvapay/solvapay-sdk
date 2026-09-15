import { describe, expect, it } from 'vitest'
import { selectBuildTasks } from '../shared/surfaces.js'
import { runCli } from './build-all.js'
import { binaryArtifactPaths, EXTERNAL_BLOB_DRIFT_BANNER } from './lib/external-blob-warning.js'

function ids(argv: string[]): string[] {
  const selected = selectBuildTasks(argv)
  if ('error' in selected) {
    throw new Error(selected.error)
  }
  return selected.map(task => task.id.split('.')[0] ?? task.id)
}

describe('selectBuildTasks', () => {
  it('should yield only core surfaces when no flags are set', () => {
    const selected = selectBuildTasks([])
    if ('error' in selected) {
      throw new Error(selected.error)
    }
    expect(selected.every(task => task.id.startsWith('go-guest'))).toBe(false)
    expect(selected.some(task => task.id.startsWith('rust.'))).toBe(true)
    expect(selected.some(task => task.id.startsWith('python.'))).toBe(false)
  })

  it('should yield core and native surfaces with --native', () => {
    const selected = selectBuildTasks(['--native'])
    if ('error' in selected) {
      throw new Error(selected.error)
    }
    expect(selected.some(task => task.id.startsWith('rust.'))).toBe(true)
    expect(selected.some(task => task.id.startsWith('python.'))).toBe(true)
  })

  it('should yield only native surfaces with --native-only', () => {
    const selected = selectBuildTasks(['--native-only'])
    if ('error' in selected) {
      throw new Error(selected.error)
    }
    expect(selected.some(task => task.id.startsWith('rust.'))).toBe(false)
    expect(selected.some(task => task.id.startsWith('python.'))).toBe(true)
  })

  it('should narrow to a single surface with --only', () => {
    const names = new Set(ids(['--only', 'go']))
    expect([...names]).toEqual(['go'])
  })

  it('should error listing valid names for an unknown --only value', () => {
    const selected = selectBuildTasks(['--only', 'fortran'])
    expect('error' in selected).toBe(true)
    if ('error' in selected) {
      expect(selected.error).toMatch(/fortran/)
      expect(selected.error).toMatch(/rust/)
      expect(selected.error).toMatch(/python/)
    }
  })
})

describe('native-only blob warning', () => {
  const quietDeps = {
    spawn: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
    now: () => 0,
    which: () => true,
    write: () => undefined,
  }

  it('warns after a successful --native-only build when hashes drift', async () => {
    const result = await runCli(['--native-only'], {
      ...quietDeps,
      digest: () => '0'.repeat(64),
      registryText: binaryArtifactPaths()
        .map(rel => `${'a'.repeat(64)}  ${rel}`)
        .join('\n'),
    })
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toContain(EXTERNAL_BLOB_DRIFT_BANNER)
    expect(result.stderr).toContain('pnpm generated:external --rebuild')
  })

  it('does not warn for a core-only build', async () => {
    const result = await runCli([], {
      ...quietDeps,
      digest: () => '0'.repeat(64),
      registryText: `${'a'.repeat(64)}  ignored.wasm\n`,
    })
    expect(result.stderr).not.toContain(EXTERNAL_BLOB_DRIFT_BANNER)
  })
})
