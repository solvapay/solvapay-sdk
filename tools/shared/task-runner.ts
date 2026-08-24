/**
 * Shared task runner for aggregate repo commands.
 *
 * Pure formatting helpers plus an injectable spawn/now/which seam so tests
 * never launch processes.
 */

import { spawn, spawnSync } from 'node:child_process'

export interface BinRequirement {
  bin: string
  install: string
}

export interface Task {
  id: string
  label: string
  command: string
  args: readonly string[]
  cwd?: string
  env?: Record<string, string>
  requires?: readonly BinRequirement[]
}

export type TaskStatus = 'ok' | 'failed' | 'skipped'

export interface TaskResult {
  id: string
  label: string
  status: TaskStatus
  exitCode: number | null
  durationMs: number
  reproduce: string
  stdout: string
  stderr: string
}

export interface RunSummary {
  command: string
  durationMs: number
  exitCode: number
  stderr: string
  tasks: TaskResult[]
}

export interface RunOptions {
  command: string
  json?: boolean
  bail?: boolean
}

export interface RunnerDeps {
  spawn(task: Task): Promise<{ exitCode: number; stdout: string; stderr: string }>
  now(): number
  which(bin: string): boolean
  write?(chunk: string): void
}

function reproduceLine(task: Task): string {
  const invocation = [task.command, ...task.args].join(' ')
  if (task.cwd === undefined) {
    return invocation
  }
  return `(cd ${task.cwd} && ${invocation})`
}

function defaultWhich(bin: string): boolean {
  const probe = process.platform === 'win32' ? 'where' : 'which'
  const result = spawnSync(probe, [bin], { encoding: 'utf8' })
  return result.status === 0
}

function defaultSpawn(opts: RunOptions, write?: (chunk: string) => void): RunnerDeps['spawn'] {
  return task =>
    new Promise((resolve, reject) => {
      const child = spawn(task.command, [...task.args], {
        cwd: task.cwd,
        env: task.env === undefined ? process.env : { ...process.env, ...task.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8')
        stdout += text
        if (opts.json !== true) {
          write?.(text)
        }
      })
      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8')
        stderr += text
        if (opts.json !== true) {
          write?.(text)
        }
      })
      child.on('error', reject)
      child.on('close', code => {
        resolve({ exitCode: code ?? 1, stdout, stderr })
      })
    })
}

function failedCount(tasks: readonly TaskResult[]): number {
  return tasks.filter(task => task.status === 'failed').length
}

export async function runTasks(
  tasks: readonly Task[],
  opts: RunOptions,
  deps: Partial<RunnerDeps> = {},
): Promise<RunSummary> {
  const now = deps.now ?? Date.now
  const which = deps.which ?? defaultWhich
  const write = deps.write ?? (chunk => process.stdout.write(chunk))
  const started = now()

  const missing: BinRequirement[] = []
  const seen = new Set<string>()
  for (const task of tasks) {
    for (const req of task.requires ?? []) {
      if (seen.has(req.bin)) {
        continue
      }
      seen.add(req.bin)
      if (!which(req.bin)) {
        missing.push(req)
      }
    }
  }

  if (missing.length > 0) {
    const lines = missing.map(req => `missing ${req.bin} — install: ${req.install}`)
    return {
      command: opts.command,
      durationMs: now() - started,
      exitCode: 1,
      stderr: `${lines.join('\n')}\n`,
      tasks: [],
    }
  }

  const results: TaskResult[] = []
  let bailed = false

  for (const task of tasks) {
    if (bailed) {
      results.push({
        id: task.id,
        label: task.label,
        status: 'skipped',
        exitCode: null,
        durationMs: 0,
        reproduce: reproduceLine(task),
        stdout: '',
        stderr: '',
      })
      continue
    }

    if (opts.json !== true) {
      write(`▸ ${task.id}  ${task.label}\n`)
    }

    const spawnTask = deps.spawn ?? defaultSpawn(opts, write)
    const taskStarted = now()
    const output = await spawnTask(task)
    const durationMs = now() - taskStarted
    const status: TaskStatus = output.exitCode === 0 ? 'ok' : 'failed'
    results.push({
      id: task.id,
      label: task.label,
      status,
      exitCode: output.exitCode,
      durationMs,
      reproduce: reproduceLine(task),
      stdout: output.stdout,
      stderr: output.stderr,
    })
    if (status === 'failed' && opts.bail === true) {
      bailed = true
    }
  }

  return {
    command: opts.command,
    durationMs: now() - started,
    exitCode: failedCount(results),
    stderr: '',
    tasks: results,
  }
}

function padEnd(value: string, width: number): string {
  if (value.length >= width) {
    return value
  }
  return value + ' '.repeat(width - value.length)
}

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`
  }
  return `${(ms / 1000).toFixed(1)}s`
}

export function formatSummary(summary: RunSummary): string {
  const labelWidth = Math.max(0, ...summary.tasks.map(task => task.label.length))
  const statusWidth = Math.max(2, ...summary.tasks.map(task => task.status.length))
  const lines: string[] = []
  for (const task of summary.tasks) {
    lines.push(
      `  ${padEnd(task.label, labelWidth)}  ${padEnd(task.status, statusWidth)}  ${formatDuration(task.durationMs)}`,
    )
    if (task.status === 'failed') {
      lines.push(`    reproduce: ${task.reproduce}`)
    }
  }
  const failed = failedCount(summary.tasks)
  const ok = summary.tasks.filter(task => task.status === 'ok').length
  lines.push(
    `${summary.command}: ${ok} ok, ${failed} failed (${formatDuration(summary.durationMs)})`,
  )
  return `${lines.join('\n')}\n`
}

export function serializeSummary(summary: RunSummary): string {
  const failed = failedCount(summary.tasks)
  const ok = summary.tasks.filter(task => task.status === 'ok').length
  const skipped = summary.tasks.filter(task => task.status === 'skipped').length
  return `${JSON.stringify(
    {
      command: summary.command,
      durationMs: summary.durationMs,
      exitCode: summary.exitCode,
      tasks: summary.tasks,
      summary: {
        total: summary.tasks.length,
        ok,
        failed,
        skipped,
      },
    },
    null,
    2,
  )}\n`
}

export function renderRun(summary: RunSummary, json: boolean): { stdout: string; stderr: string } {
  if (json) {
    return { stdout: serializeSummary(summary), stderr: summary.stderr }
  }
  return { stdout: formatSummary(summary), stderr: summary.stderr }
}
