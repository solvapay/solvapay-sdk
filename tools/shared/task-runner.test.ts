import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  formatSummary,
  runTasks,
  serializeSummary,
  taskEnv,
  type RunSummary,
  type Task,
} from './task-runner.js'

function task(overrides: Partial<Task> & Pick<Task, 'id'>): Task {
  return {
    label: overrides.label ?? overrides.id,
    command: 'cargo',
    args: ['test'],
    ...overrides,
  }
}

function sequentialNow(start = 1_000): () => number {
  let current = start
  return () => {
    const value = current
    current += 25
    return value
  }
}

describe('runTasks', () => {
  it('should report a failed task as failed with its reproduce line', async () => {
    const failing = task({
      id: 'rust.workspace.test',
      command: 'cargo',
      args: ['test', '--workspace'],
    })
    let spawnCount = 0

    const summary = await runTasks(
      [failing],
      { command: 'test:all' },
      {
        spawn: async () => {
          spawnCount += 1
          return { exitCode: 1, stdout: '', stderr: 'boom' }
        },
        now: sequentialNow(),
        which: () => true,
        write: () => undefined,
      },
    )

    expect(spawnCount).toBe(1)
    expect(summary.tasks[0]?.status).toBe('failed')
    expect(summary.tasks[0]?.reproduce).toBe('cargo test --workspace')
  })

  it('should set the run exit code equal to the failed task count', async () => {
    const tasks = [
      task({ id: 'a', args: ['a'] }),
      task({ id: 'b', args: ['b'] }),
      task({ id: 'c', args: ['c'] }),
    ]
    const summary = await runTasks(
      tasks,
      { command: 'test:all' },
      {
        spawn: async current => ({
          exitCode: current.id === 'b' || current.id === 'c' ? 1 : 0,
          stdout: '',
          stderr: '',
        }),
        now: sequentialNow(),
        which: () => true,
        write: () => undefined,
      },
    )

    expect(summary.exitCode).toBe(2)
  })

  it('should treat a cwd node_modules/.bin shim as satisfying requires', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'task-runner-'))
    mkdirSync(join(cwd, 'node_modules', '.bin'), { recursive: true })
    writeFileSync(join(cwd, 'node_modules', '.bin', 'napi'), '')
    try {
      let spawnCount = 0
      const summary = await runTasks(
        [
          task({
            id: 'node-native.prepare',
            command: 'napi',
            args: ['build'],
            cwd,
            requires: [{ bin: 'napi', install: 'pnpm add -Dw @napi-rs/cli' }],
          }),
        ],
        { command: 'test:live' },
        {
          spawn: async () => {
            spawnCount += 1
            return { exitCode: 0, stdout: '', stderr: '' }
          },
          now: sequentialNow(),
          which: () => false,
          write: () => undefined,
        },
      )
      expect(spawnCount).toBe(1)
      expect(summary.exitCode).toBe(0)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('should prepend cwd node_modules/.bin onto PATH for spawned tasks', () => {
    const cwd = '/tmp/solvapay-sdk-native'
    const env = taskEnv({
      id: 'wasm.prepare',
      label: 'WASM',
      command: 'wasm-opt',
      args: ['-Oz'],
      cwd,
      env: { PATH: '/usr/bin' },
    })
    expect(env.PATH).toBe(`${join(cwd, 'node_modules', '.bin')}${delimiter}/usr/bin`)
  })

  it('should fail preflight for a missing requires.bin before any spawn', async () => {
    const needingMaturin = task({
      id: 'python.build',
      command: 'maturin',
      args: ['build', '--release'],
      requires: [{ bin: 'maturin', install: 'pip install maturin' }],
    })
    let spawnCount = 0

    const summary = await runTasks(
      [needingMaturin],
      { command: 'build:all' },
      {
        spawn: async () => {
          spawnCount += 1
          return { exitCode: 0, stdout: '', stderr: '' }
        },
        now: sequentialNow(),
        which: bin => bin !== 'maturin',
        write: () => undefined,
      },
    )

    expect(spawnCount).toBe(0)
    expect(summary.exitCode).toBe(1)
    expect(summary.stderr).toMatch(/maturin/)
    expect(summary.stderr).toMatch(/pip install maturin/)
  })

  it('should round-trip --json output through JSON.parse with stable id keys', async () => {
    const summary = await runTasks(
      [task({ id: 'go.test', label: 'Go', command: 'go', args: ['test', './...'] })],
      { command: 'test:all', json: true },
      {
        spawn: async () => ({ exitCode: 0, stdout: 'ok', stderr: '' }),
        now: sequentialNow(),
        which: () => true,
        write: () => undefined,
      },
    )

    const parsed = JSON.parse(serializeSummary(summary)) as {
      command: string
      tasks: Array<{ id: string; status: string }>
    }
    expect(parsed.command).toBe('test:all')
    expect(parsed.tasks[0]?.id).toBe('go.test')
    expect(parsed.tasks[0]?.status).toBe('ok')
  })
})

describe('formatSummary', () => {
  it('should align columns for mixed-width labels', () => {
    const summary: RunSummary = {
      command: 'build:all',
      durationMs: 50,
      exitCode: 1,
      stderr: '',
      tasks: [
        {
          id: 'go.build',
          label: 'Go',
          status: 'ok',
          exitCode: 0,
          durationMs: 10,
          reproduce: 'go build ./...',
          stdout: '',
          stderr: '',
        },
        {
          id: 'typescript.packages.build',
          label: 'TypeScript packages',
          status: 'failed',
          exitCode: 1,
          durationMs: 20,
          reproduce: 'pnpm build:packages',
          stdout: '',
          stderr: '',
        },
      ],
    }

    const lines = formatSummary(summary)
      .split('\n')
      .filter(line => line.includes('ok') || line.includes('failed'))
    const statusAt = (line: string, token: string): number => line.indexOf(token)
    expect(statusAt(lines[0] ?? '', 'ok')).toBe(statusAt(lines[1] ?? '', 'failed'))
  })
})
