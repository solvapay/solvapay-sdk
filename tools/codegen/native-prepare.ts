/**
 * Rebuild Ruby and Python native extensions after dto-gen rewrites their
 * binding sources. Tracked WASI / NAPI artifacts stay out of this path.
 */

import { spawnSync } from 'node:child_process'
import { SURFACES } from '../shared/surfaces.js'
import {
  isBinAvailable,
  taskEnv,
  whichBin,
  type BinRequirement,
  type Task,
} from '../shared/task-runner.js'
import type { CliResult } from './lib/cli.js'

export const GEN_PREPARE_SURFACE_IDS = ['ruby', 'python'] as const

export interface PrepareSkip {
  surface: string
  requirement: BinRequirement
}

export interface PreparePlan {
  tasks: Task[]
  skipped: PrepareSkip[]
}

export function planNativePrepare(which: (bin: string) => boolean = whichBin): PreparePlan {
  const tasks: Task[] = []
  const skipped: PrepareSkip[] = []
  for (const id of GEN_PREPARE_SURFACE_IDS) {
    const surface = SURFACES.find(item => item.id === id)
    if (surface === undefined) {
      throw new Error(`native prepare surface '${id}' is no longer registered in surfaces.ts`)
    }
    const missing = (surface.requires ?? []).find(
      req => !isBinAvailable(req.bin, surface.cwd, which),
    )
    if (missing !== undefined) {
      skipped.push({ surface: id, requirement: missing })
      continue
    }
    tasks.push(...(surface.prepare ?? surface.build))
  }
  return { tasks, skipped }
}

export interface NativePrepareDeps {
  spawn?: typeof spawnSync
}

function reproduceLine(task: Task): string {
  const invocation = [task.command, ...task.args].join(' ')
  if (task.cwd === undefined) {
    return invocation
  }
  return `(cd ${task.cwd} && ${invocation})`
}

export function runNativePrepare(plan: PreparePlan, deps: NativePrepareDeps = {}): CliResult {
  const spawn = deps.spawn ?? spawnSync
  const skipNotes = plan.skipped.map(
    item =>
      `skipped ${item.surface} binding rebuild - no ${item.requirement.bin} (install: ${item.requirement.install})`,
  )
  for (const note of skipNotes) {
    process.stdout.write(`${note}\n`)
  }
  for (const task of plan.tasks) {
    const result = spawn(task.command, [...task.args], {
      cwd: task.cwd,
      env: taskEnv(task),
      stdio: 'inherit',
    })
    const status = result.status ?? 1
    if (status !== 0) {
      return {
        exitCode: status,
        stdout: skipNotes.join('\n'),
        stderr:
          `native prepare failed for ${task.id} after successful generation.\n` +
          `This is a local rebuild failure, not a codegen break.\n` +
          `Reproduce: ${reproduceLine(task)}\n`,
      }
    }
  }
  return {
    exitCode: 0,
    stdout: skipNotes.length === 0 ? '' : `${skipNotes.join('\n')}\n`,
    stderr: '',
  }
}
