import { describe, expect, it } from 'vitest'
import { liveTasks, resolveLiveEnv, runCli } from './live-all.js'
import { lookupPath, sdkPath } from '../shared/repo-paths.js'

describe('resolveLiveEnv', () => {
  it('should error naming both required variables when env is empty', () => {
    const resolved = resolveLiveEnv({})
    expect('error' in resolved).toBe(true)
    if ('error' in resolved) {
      expect(resolved.error).toMatch(/SOLVAPAY_SHADOW_BASE_URL/)
      expect(resolved.error).toMatch(/SOLVAPAY_SHADOW_API_KEY/)
    }
  })

  it('should derive USE_REAL_BACKEND and SOLVAPAY_SECRET_KEY from a populated env', () => {
    const resolved = resolveLiveEnv({
      SOLVAPAY_SHADOW_BASE_URL: 'http://localhost:3010',
      SOLVAPAY_SHADOW_API_KEY: 'sk_sandbox_test',
    })
    expect('error' in resolved).toBe(false)
    if ('error' in resolved) {
      return
    }
    expect(resolved.env.USE_REAL_BACKEND).toBe('true')
    expect(resolved.env.SOLVAPAY_SECRET_KEY).toBe('sk_sandbox_test')
    expect(resolved.env.SOLVAPAY_API_BASE_URL).toBe('http://localhost:3010')
  })

  it('should mention localhost:3010 and not :3001 in the error text', () => {
    const resolved = resolveLiveEnv({})
    expect('error' in resolved).toBe(true)
    if ('error' in resolved) {
      expect(resolved.error).toContain('http://localhost:3010')
      expect(resolved.error).not.toContain(':3001')
    }
  })
})

describe('liveTasks', () => {
  it('runs the Python driver from sdks/python through uv', () => {
    const python = liveTasks({}).find(task => task.id === 'live.python')
    expect(python).toBeDefined()
    expect(python?.command).toBe('uv')
    expect(python?.args).toEqual(['run', 'python', lookupPath('pythonLiveContract')])
    expect(python?.cwd).toBe(sdkPath('python'))
  })

  it('should prepend native prepare tasks and a shadow-invoker build', () => {
    const ids = liveTasks({}).map(task => task.id)
    expect(ids.slice(0, 7)).toEqual([
      'node-native.prepare',
      'wasm.prepare',
      'python.prepare',
      'ruby.bundle',
      'ruby.prepare',
      'go-guest.build',
      'live.build.shadow-invoker',
    ])
    expect(ids[7]).toBe('live.ts')
    expect(ids).not.toContain('python.build')
  })

  it('should skip the build phase when skipBuild is set', () => {
    const ids = liveTasks({}, { skipBuild: true }).map(task => task.id)
    expect(ids[0]).toBe('live.ts')
    expect(ids).not.toContain('live.build.shadow-invoker')
    expect(ids).not.toContain('python.prepare')
  })

  it('should run the Ruby driver with plain ruby', () => {
    const ruby = liveTasks({}).find(task => task.id === 'live.ruby')
    expect(ruby?.command).toBe('ruby')
    expect(ruby?.args).toEqual([lookupPath('rubyLiveContract')])
    expect(ruby?.requires?.some(req => req.bin === 'ruby')).toBe(true)
  })
})

describe('runCli', () => {
  it('should skip the build phase when --no-build is passed', async () => {
    const spawned: string[] = []
    const result = await runCli(['--no-build'], {
      env: {
        SOLVAPAY_SHADOW_BASE_URL: 'http://localhost:3010',
        SOLVAPAY_SHADOW_API_KEY: 'sk_sandbox_test',
      },
      fetch: async () => ({ ok: true, status: 200 }),
      which: () => true,
      spawn: async task => {
        spawned.push(task.id)
        return { exitCode: 0, stdout: '', stderr: '' }
      },
      now: () => 0,
      write: () => {},
    })
    expect(result.exitCode).toBe(0)
    expect(spawned[0]).toBe('live.ts')
    expect(spawned).not.toContain('live.build.shadow-invoker')
    expect(spawned).not.toContain('python.prepare')
  })
})
