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

  it('should prepare then test python-mcp including the paid-MCP example', () => {
    const selected = selectTestTasks(['--native-only', '--only', 'python-mcp'])
    if ('error' in selected) {
      throw new Error(selected.error)
    }
    expect(selected.map(task => task.id)).toEqual([
      'python-mcp.prepare',
      'python-mcp.test',
      'python-mcp.example',
    ])
  })

  it('should set RUBYLIB when testing ruby-mcp', () => {
    const selected = selectTestTasks(['--native-only', '--only', 'ruby-mcp'])
    if ('error' in selected) {
      throw new Error(selected.error)
    }
    expect(selected.map(task => task.id)).toEqual([
      'ruby.bundle',
      'ruby-mcp.compile',
      'ruby-mcp.bundle',
      'ruby-mcp.test',
      'ruby-mcp.example',
    ])
    const suite = selected.find(task => task.id === 'ruby-mcp.test')
    expect(suite?.env?.RUBYLIB).toMatch(/sdks\/ruby\/lib$/)
  })

  it('should run bundle install before every rake compile', () => {
    const selected = selectTestTasks(['--native-only'])
    if ('error' in selected) {
      throw new Error(selected.error)
    }
    const compileIndexes = selected.flatMap((task, index) =>
      task.command === 'bundle' && task.args.includes('compile') ? [index] : [],
    )
    expect(compileIndexes.length).toBeGreaterThan(0)
    for (const compileIndex of compileIndexes) {
      const preceding = selected.slice(0, compileIndex)
      const bundled = preceding.some(
        task =>
          task.command === 'bundle' &&
          task.args.length === 1 &&
          task.args[0] === 'install' &&
          task.cwd === selected[compileIndex]?.cwd,
      )
      expect(bundled, selected[compileIndex]?.id).toBe(true)
    }
  })
})
