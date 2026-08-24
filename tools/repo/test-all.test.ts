import { describe, expect, it } from 'vitest'
import { selectTestTasks } from '../shared/surfaces.js'

describe('selectTestTasks', () => {
  it('should yield only core surfaces when no flags are set', () => {
    const selected = selectTestTasks([])
    if ('error' in selected) {
      throw new Error(selected.error)
    }
    expect(selected.some(task => task.id.startsWith('rust.'))).toBe(true)
    expect(selected.some(task => task.id.startsWith('python.'))).toBe(false)
  })

  it('should yield core and native surfaces with --native', () => {
    const selected = selectTestTasks(['--native'])
    if ('error' in selected) {
      throw new Error(selected.error)
    }
    expect(selected.some(task => task.id.startsWith('rust.'))).toBe(true)
    expect(selected.some(task => task.id.startsWith('python.'))).toBe(true)
  })

  it('should yield only native surfaces with --native-only', () => {
    const selected = selectTestTasks(['--native-only'])
    if ('error' in selected) {
      throw new Error(selected.error)
    }
    expect(selected.some(task => task.id.startsWith('rust.'))).toBe(false)
    expect(selected.some(task => task.id.startsWith('python.'))).toBe(true)
  })

  it('should narrow to a single surface with --only', () => {
    const selected = selectTestTasks(['--only', 'go'])
    if ('error' in selected) {
      throw new Error(selected.error)
    }
    expect(selected.map(task => task.id)).toEqual(['go.test'])
  })

  it('should error listing valid names for an unknown --only value', () => {
    const selected = selectTestTasks(['--only', 'fortran'])
    expect('error' in selected).toBe(true)
    if ('error' in selected) {
      expect(selected.error).toMatch(/fortran/)
      expect(selected.error).toMatch(/Valid names/)
    }
  })

  it('should order prepare tasks before the native suite that needs them', () => {
    const selected = selectTestTasks(['--native-only', '--only', 'python'])
    if ('error' in selected) {
      throw new Error(selected.error)
    }
    expect(selected.map(task => task.id)).toEqual(['python.prepare', 'python.test'])
  })
})
