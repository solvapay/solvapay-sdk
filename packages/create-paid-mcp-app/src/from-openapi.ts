/**
 * `from-openapi` mode — build a sensible `selections.json` from the
 * spec, hand it to `scripts/scaffold.mjs` (which owns the per-spec
 * codegen), then run the install + `runInitInDirectory` postlude.
 *
 * The CLI auto-builds selections for the 80% case (every operation →
 * `suggestedTier`, top-level auth inferred from the first supported
 * scheme). Power users who need intent-driven clustering or per-op tier
 * decisions should run the scaffolder through Cursor / Claude Code with
 * the `create-paid-mcp-app` skill loaded.
 */

import { spawn } from 'node:child_process'
import { rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import readline from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { detectPackageManager, runInitInDirectory } from '@solvapay/cli-core'
import type { InitCommandOptions } from '@solvapay/cli-core'
import {
  assertTargetDirAbsent,
  installProjectDependencies,
  PLACEHOLDERS,
  SCAFFOLD_SCRIPT_PATH,
} from './scaffold'

export type FromOpenapiInput = {
  target: string
  projectName: string
  spec: string
  options: InitCommandOptions
  productRef?: string
  nonInteractive: boolean
}

type Selections = {
  workerName: string
  mcpPublicBaseUrl: string
  solvapayProductRef?: string
  mode: 'one-to-one'
  upstreamAuth:
    | { kind: 'none' }
    | { kind: 'bearer'; key: string }
    | { kind: 'apiKey'; in: 'header'; name: string; key: string }
  operations: Array<{ operationId: string; tier: 'free' | 'paid' | 'skip' }>
}

export async function runFromOpenapi(input: FromOpenapiInput): Promise<void> {
  const { target, projectName, spec, options, productRef, nonInteractive } = input

  await assertTargetDirAbsent(target)

  process.stdout.write(`📁 Scaffolding ${projectName} (from-openapi) at ${target}\n`)
  process.stdout.write(`🔎 Loading spec: ${spec}\n`)

  const describeOutput = await runScriptCaptureJson(['describe.mjs', spec, '--no-probe'])
  const operations = Array.isArray(describeOutput.operations) ? describeOutput.operations : []
  const securitySchemes = Array.isArray(describeOutput.securitySchemes)
    ? describeOutput.securitySchemes
    : []

  if (operations.length === 0) {
    throw new Error(
      `No operations found in spec ${spec}. Check the spec URL/path or try a different document.`,
    )
  }

  const authChoice = await chooseAuth(securitySchemes, nonInteractive)
  const selections: Selections = {
    workerName: projectName,
    mcpPublicBaseUrl: 'http://localhost:8787',
    solvapayProductRef: productRef ?? PLACEHOLDERS.PRODUCT_REF,
    mode: 'one-to-one',
    upstreamAuth: authChoice,
    operations: operations.map((op: { operationId: string; suggestedTier: 'free' | 'paid' | 'skip' }) => ({
      operationId: op.operationId,
      tier: op.suggestedTier,
    })),
  }

  const tmpSelectionsPath = join(
    tmpdir(),
    `create-paid-mcp-app-selections-${Date.now()}-${process.pid}.json`,
  )
  await writeFile(tmpSelectionsPath, JSON.stringify(selections, null, 2), 'utf8')

  try {
    process.stdout.write(`⚙️  Generating ${operations.length} tool stubs…\n`)
    await runScript([
      'scaffold.mjs',
      spec,
      target,
      '--selections',
      tmpSelectionsPath,
    ])
  } finally {
    await rm(tmpSelectionsPath, { force: true })
  }

  const packageManager = await detectPackageManager(target)
  process.stdout.write(`📦 Installing dependencies with ${packageManager}...\n`)
  const installResult = await installProjectDependencies(packageManager, target, message => {
    process.stdout.write(`   ${message}\n`)
  })
  if (!installResult.ok) {
    process.stdout.write(
      `⚠️  ${installResult.command} failed (${installResult.warning ?? 'unknown error'}). ` +
        `Run \`${packageManager} install\` manually inside ${target} before deploying.\n`,
    )
  } else {
    process.stdout.write('✅ Dependencies installed\n')
  }

  process.stdout.write('\n')
  await runInitInDirectory({ cwd: target, options, skipSdkInstall: true })

  process.stdout.write(`\n🎉 Done. Next steps:\n`)
  process.stdout.write(`   cd ${projectName}\n`)
  process.stdout.write(`   ${packageManager === 'npm' ? 'npm run' : packageManager} dev\n`)
}

async function chooseAuth(
  schemes: Array<{
    supported?: boolean
    kind?: string
    headerName?: string
  }>,
  nonInteractive: boolean,
): Promise<Selections['upstreamAuth']> {
  const firstSupported = schemes.find(s => s.supported === true && (s.kind === 'http-bearer' || s.kind === 'apiKey-header'))
  if (!firstSupported) {
    return { kind: 'none' }
  }

  const askKey = async (prompt: string): Promise<string> => {
    if (nonInteractive) {
      throw new Error(
        `Spec requires upstream auth (${firstSupported.kind}); pass --non-interactive only after setting ` +
          `the key via UPSTREAM_API_KEY in the generated .env. Run interactively for the guided flow.`,
      )
    }
    if (!stdin.isTTY || !stdout.isTTY) {
      return ''
    }
    const rl = readline.createInterface({ input: stdin, output: stdout })
    try {
      const value = (await rl.question(prompt)).trim()
      return value
    } finally {
      rl.close()
    }
  }

  if (firstSupported.kind === 'http-bearer') {
    const key = await askKey(
      'Spec requires bearer auth. Paste the upstream API key (skips into .env, blank = skip): ',
    )
    if (!key) return { kind: 'none' }
    return { kind: 'bearer', key }
  }

  const headerName = firstSupported.headerName ?? 'X-API-Key'
  const key = await askKey(
    `Spec requires apiKey auth (${headerName}). Paste the upstream API key (blank = skip): `,
  )
  if (!key) return { kind: 'none' }
  return { kind: 'apiKey', in: 'header', name: headerName, key }
}

async function ensureScriptDepsInstalled(): Promise<void> {
  const scriptsDir = join(SCAFFOLD_SCRIPT_PATH, '..')
  try {
    await stat(join(scriptsDir, 'node_modules'))
    return
  } catch {
    // proceed to install
  }
  process.stdout.write('📦 Installing scaffolder helpers (one-time)…\n')
  await new Promise<void>((resolve, reject) => {
    const child = spawn('npm', ['install', '--no-audit', '--no-fund', '--silent'], {
      cwd: scriptsDir,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })
    child.once('error', reject)
    child.once('close', code => {
      if (code === 0) resolve()
      else reject(new Error(`npm install for scripts/ exited with code ${code}`))
    })
  })
}

async function runScriptCaptureJson(argv: string[]): Promise<Record<string, unknown>> {
  await ensureScriptDepsInstalled()
  const [scriptName, ...rest] = argv
  const scriptsDir = join(SCAFFOLD_SCRIPT_PATH, '..')
  const scriptPath = join(scriptsDir, scriptName)
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...rest], {
      cwd: scriptsDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdoutBuf = ''
    let stderrBuf = ''
    child.stdout.on('data', chunk => {
      stdoutBuf += chunk.toString('utf8')
    })
    child.stderr.on('data', chunk => {
      stderrBuf += chunk.toString('utf8')
    })
    child.once('error', reject)
    child.once('close', code => {
      if (code !== 0) {
        reject(new Error(`${scriptName} exited with code ${code}: ${stderrBuf.trim()}`))
        return
      }
      try {
        const parsed = JSON.parse(stdoutBuf) as Record<string, unknown>
        resolve(parsed)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown error'
        reject(
          new Error(
            `${scriptName} produced non-JSON output: ${message}\n--stdout--\n${stdoutBuf.slice(0, 500)}`,
          ),
        )
      }
    })
  })
}

async function runScript(argv: string[]): Promise<void> {
  await ensureScriptDepsInstalled()
  const [scriptName, ...rest] = argv
  const scriptsDir = join(SCAFFOLD_SCRIPT_PATH, '..')
  const scriptPath = join(scriptsDir, scriptName)
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...rest], {
      cwd: scriptsDir,
      stdio: ['ignore', 'inherit', 'inherit'],
    })
    child.once('error', reject)
      child.once('close', code => {
      if (code === 0) resolve()
      else reject(new Error(`${scriptName} exited with code ${code}`))
    })
  })
}
