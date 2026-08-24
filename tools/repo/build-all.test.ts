import { describe, expect, it } from 'vitest'
import { selectBuildTasks } from '../shared/surfaces.js'

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
