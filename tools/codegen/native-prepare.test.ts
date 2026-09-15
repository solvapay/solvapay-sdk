import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { SURFACES } from '../shared/surfaces.js'
import { REPO_ROOT } from '../shared/paths.js'
import { externalGeneratedEntries } from '../shared/repo-paths.js'
import { GEN_PREPARE_SURFACE_IDS, planNativePrepare, runNativePrepare } from './native-prepare.js'

describe('native-prepare', () => {
  it('plans ruby then python when bundle and uv resolve', () => {
    const plan = planNativePrepare(bin => bin === 'bundle' || bin === 'uv')
    expect(plan.skipped).toEqual([])
    expect(plan.tasks.map(task => task.id)).toEqual([
      'ruby.bundle',
      'ruby.prepare',
      'python.prepare',
    ])
    expect(plan.tasks[0]?.args).toEqual(['install'])
    expect(plan.tasks[1]?.args).toEqual(['exec', 'rake', 'compile'])
  })

  it('skips only the surface whose toolchain is missing', () => {
    const plan = planNativePrepare(bin => bin === 'uv')
    expect(plan.skipped).toEqual([
      {
        surface: 'ruby',
        requirement: { bin: 'bundle', install: 'gem install bundler' },
      },
    ])
    expect(plan.tasks.map(task => task.id)).toEqual(['python.prepare'])
  })

  it('never prepares surfaces with tracked externalGenerated artifacts', () => {
    expect(GEN_PREPARE_SURFACE_IDS).toEqual(['ruby', 'python'])
    expect(GEN_PREPARE_SURFACE_IDS).not.toContain('node-native')
    expect(GEN_PREPARE_SURFACE_IDS).not.toContain('wasm')
    const tracked = externalGeneratedEntries().flatMap(entry => entry.paths)
    for (const id of GEN_PREPARE_SURFACE_IDS) {
      const surface = SURFACES.find(item => item.id === id)
      expect(surface).toBeDefined()
      if (surface === undefined) continue
      const cwdRel = path.relative(REPO_ROOT, surface.cwd)
      for (const rel of tracked) {
        expect(rel === cwdRel || rel.startsWith(`${cwdRel}/`)).toBe(false)
      }
    }
  })

  it('reports a reproduce line without calling the failure a codegen break', () => {
    const spawn = vi.fn().mockReturnValue({ status: 1 })
    const plan = planNativePrepare(() => true)
    const result = runNativePrepare({ tasks: plan.tasks.slice(0, 1), skipped: [] }, { spawn })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('local rebuild failure, not a codegen break')
    expect(result.stderr).toContain('bundle install')
  })
})
