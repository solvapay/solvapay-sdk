/**
 * Drive every live-contract driver against a reachable local platform stack.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { lookupPath, sdkPath } from '../shared/repo-paths.js'
import { REPO_ROOT } from '../shared/paths.js'
import { renderRun, runTasks, type RunnerDeps, type Task } from '../shared/task-runner.js'

const PROVIDER_PROXY = 'http://localhost:3010'

export interface LiveEnv {
  env: Record<string, string>
}

export function resolveLiveEnv(
  env: Record<string, string | undefined>,
): LiveEnv | { error: string } {
  const baseUrl = env.SOLVAPAY_SHADOW_BASE_URL
  const apiKey = env.SOLVAPAY_SHADOW_API_KEY
  if (baseUrl === undefined || baseUrl === '' || apiKey === undefined || apiKey === '') {
    return {
      error:
        'SOLVAPAY_SHADOW_BASE_URL and SOLVAPAY_SHADOW_API_KEY are required. ' +
        `Point the base URL at the provider-app proxy (${PROVIDER_PROXY}) which fans /v1/* out to owning services. ` +
        'Create an sk_sandbox_* key in Developers → Secret keys.',
    }
  }
  return {
    env: {
      SOLVAPAY_SHADOW_BASE_URL: baseUrl,
      SOLVAPAY_SHADOW_API_KEY: apiKey,
      USE_REAL_BACKEND: 'true',
      SOLVAPAY_SECRET_KEY: apiKey,
    },
  }
}

function liveTasks(extraEnv: Record<string, string>): Task[] {
  const goCwd = sdkPath('go')
  const pythonScript = lookupPath('pythonLiveContract')
  const rubyScript = lookupPath('rubyLiveContract')
  const shadowOut = lookupPath('shadowOutput')
  const env = extraEnv
  return [
    {
      id: 'live.ts',
      label: 'TypeScript shadow',
      command: 'pnpm',
      args: ['shadow:run'],
      cwd: REPO_ROOT,
      env,
    },
    {
      id: 'live.rust',
      label: 'Rust live-contract',
      command: 'cargo',
      args: ['run', '-p', 'live-contract', '--release'],
      cwd: REPO_ROOT,
      env,
    },
    {
      id: 'live.python',
      label: 'Python live-contract',
      command: 'python3',
      args: [pythonScript],
      cwd: REPO_ROOT,
      env,
    },
    {
      id: 'live.ruby',
      label: 'Ruby live-contract',
      command: 'bundle',
      args: ['exec', 'ruby', rubyScript],
      cwd: sdkPath('ruby'),
      env,
    },
    {
      id: 'live.go',
      label: 'Go live-contract',
      command: 'go',
      args: ['run', './cmd/live-contract'],
      cwd: goCwd,
      env,
    },
    {
      id: 'live.ts.integration',
      label: 'TypeScript integration',
      command: 'pnpm',
      args: ['-F', '@solvapay/server', 'test:integration'],
      cwd: REPO_ROOT,
      env,
    },
  ].map(task => ({
    ...task,
    // Keep the report directory discoverable in the summary reproduce line.
    label: `${task.label} (${shadowOut})`,
  }))
}

export interface LiveDeps extends Partial<RunnerDeps> {
  fetch?: (url: string) => Promise<{ ok: boolean; status: number }>
  env?: Record<string, string | undefined>
}

export interface CliResult {
  exitCode: number
  stdout: string
  stderr: string
}

export async function runCli(argv: string[], deps: LiveDeps = {}): Promise<CliResult> {
  const json = argv.includes('--json')
  const bail = argv.includes('--bail')
  const resolved = resolveLiveEnv(deps.env ?? process.env)
  if ('error' in resolved) {
    return { exitCode: 1, stdout: '', stderr: `${resolved.error}\n` }
  }

  const probe = deps.fetch ?? (url => fetch(url, { signal: AbortSignal.timeout(2000) }))
  const baseUrl = resolved.env.SOLVAPAY_SHADOW_BASE_URL
  try {
    const response = await probe(baseUrl)
    if (!response.ok) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: `live stack at ${baseUrl} returned ${response.status}. Start the local platform (provider-app proxy ${PROVIDER_PROXY}).\n`,
      }
    }
  } catch (error) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `live stack at ${baseUrl} is unreachable (${error instanceof Error ? error.message : String(error)}). Start the local platform (provider-app proxy ${PROVIDER_PROXY}).\n`,
    }
  }

  const summary = await runTasks(
    liveTasks(resolved.env),
    { command: 'test:live', json, bail },
    deps,
  )
  const rendered = renderRun(summary, json)
  return { exitCode: summary.exitCode, stdout: rendered.stdout, stderr: rendered.stderr }
}

async function main(): Promise<void> {
  const result = await runCli(process.argv.slice(2))
  if (result.stdout) {
    process.stdout.write(result.stdout)
  }
  if (result.stderr) {
    process.stderr.write(result.stderr)
  }
  process.exit(result.exitCode)
}

const isDirectRun =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  void main()
}
