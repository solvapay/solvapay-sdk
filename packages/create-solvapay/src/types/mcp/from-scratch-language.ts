/**
 * `--type mcp --language python|go` — a from-scratch paid MCP server in
 * Python (uv) or Go, with one paid tool, one free capped tool, tests and a
 * Dockerfile. Python and Go servers don't run on Cloudflare Workers, so these
 * templates share nothing with the TypeScript `_base/`.
 *
 * Order: pick the SDK version (fails before anything is written when there is
 * no stable release and this is not the preview scaffolder), check the toolchain, copy the
 * template with the version pinned, `uv sync` / `go mod tidy`, then
 * `solvapay init` for the key and product.
 */

import { spawn } from 'node:child_process'
import {
  fetchSdkVersions,
  formatCommand,
  GO_MODULE,
  LANGUAGE_LABELS,
  pickSdkVersion,
  runInitInDirectory,
  runSdkCommand,
  type InitCommandOptions,
  type SdkCommand,
  type SdkLanguage,
} from '@solvapay/init'
import {
  assertTargetDirAbsent,
  copyDir,
  deriveServerName,
  gitInit,
  GO_TEMPLATE_DIR,
  PLACEHOLDERS,
  PYTHON_TEMPLATE_DIR,
  writeLanguageBootstrapEnv,
} from './scaffold'

export const DEFAULT_SNAKE_TOOL_NAME = 'hello_tool'
const LOCAL_PORT = 8080
/** The Go version the template's go.mod and Dockerfile name. */
const MIN_GO = [1, 26] as const

export type LanguageFromScratchInput = {
  target: string
  projectName: string
  toolName: string
  language: SdkLanguage
  options: InitCommandOptions
  productRef?: string
  skipInstall?: boolean
  skipInit?: boolean
  preview?: boolean
  dev?: boolean
  /** Published SDK versions; injectable for tests. */
  sdkVersions?: (language: SdkLanguage) => Promise<string[]>
  /** Runs the toolchain commands; injectable for tests. */
  runCommand?: (
    command: SdkCommand,
    cwd: string,
  ) => Promise<{ ok: boolean; command: string; warning?: string }>
  /** Runs `solvapay init`; injectable for tests. */
  runInit?: typeof runInitInDirectory
  /** Checks uv / Go are installed; injectable for tests. */
  checkToolchain?: (language: SdkLanguage) => Promise<void>
}

const capture = (cmd: string, args: string[]): Promise<{ ok: boolean; output: string }> =>
  new Promise(resolve => {
    let output = ''
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    })
    child.stdout?.on('data', chunk => (output += chunk))
    child.stderr?.on('data', chunk => (output += chunk))
    child.once('error', () => resolve({ ok: false, output: '' }))
    child.once('close', code => resolve({ ok: code === 0, output }))
  })

/** Throws when uv (Python) or Go 1.26+ is missing: nothing can install or run without it. */
export async function assertToolchain(
  language: SdkLanguage,
  probe: typeof capture = capture,
): Promise<void> {
  if (language === 'python') {
    const uv = await probe('uv', ['--version'])
    if (!uv.ok) {
      throw new Error(
        'The Python template uses uv, which is not installed or not on PATH. Install it ' +
          '(https://docs.astral.sh/uv/getting-started/installation/) and run again, or pass --skip-install.',
      )
    }
    return
  }
  const go = await probe('go', ['version'])
  const match = /go(\d+)\.(\d+)/.exec(go.output)
  if (!go.ok || !match) {
    throw new Error(
      'Go is not installed or not on PATH. Install Go 1.26 or newer (https://go.dev/dl/), or pass --skip-install.',
    )
  }
  const [major, minor] = [Number(match[1]), Number(match[2])]
  if (major < MIN_GO[0] || (major === MIN_GO[0] && minor < MIN_GO[1])) {
    throw new Error(`The Go SDK needs Go ${MIN_GO.join('.')} or newer; found go${major}.${minor}.`)
  }
}

const syncCommand = (language: SdkLanguage): SdkCommand =>
  language === 'python' ? { cmd: 'uv', args: ['sync'] } : { cmd: 'go', args: ['mod', 'tidy'] }

export async function runLanguageFromScratch(input: LanguageFromScratchInput): Promise<void> {
  const {
    target,
    projectName,
    toolName,
    language,
    options,
    productRef,
    skipInstall,
    skipInit,
    preview = false,
    dev,
    sdkVersions = fetchSdkVersions,
    runCommand = runSdkCommand,
    runInit = runInitInDirectory,
    checkToolchain = language => assertToolchain(language),
  } = input
  const label = LANGUAGE_LABELS[language]

  await assertTargetDirAbsent(target)

  process.stdout.write(
    `🔄 Resolving the ${preview ? 'newest preview' : 'newest stable'} ${label} SDK…\n`,
  )
  const version = pickSdkVersion(language, await sdkVersions(language), { preview })
  process.stdout.write(
    `   ${language === 'python' ? `solvapay[mcp]==${version}` : `${GO_MODULE}@${version}`}\n`,
  )

  if (!skipInstall) await checkToolchain(language)

  const serverName = deriveServerName(projectName)
  const substitutions = new Map<string, string>([
    [PLACEHOLDERS.PROJECT_NAME, projectName],
    [PLACEHOLDERS.GO_MODULE, projectName],
    [PLACEHOLDERS.SERVER_NAME, serverName],
    [PLACEHOLDERS.TOOL_NAME, toolName],
    [PLACEHOLDERS.SOLVAPAY_VERSION, version],
  ])
  process.stdout.write(`📁 Scaffolding ${projectName} (${label}, from-scratch) at ${target}\n`)
  await copyDir(language === 'python' ? PYTHON_TEMPLATE_DIR : GO_TEMPLATE_DIR, target, {
    substitutions,
  })
  await writeLanguageBootstrapEnv(target, productRef ?? PLACEHOLDERS.PRODUCT_REF, {
    dev,
    port: LOCAL_PORT,
  })

  const sync = syncCommand(language)
  if (skipInstall) {
    process.stdout.write(`⏭  Skipping ${formatCommand(sync)} (--skip-install)\n`)
  } else {
    process.stdout.write(`📦 ${formatCommand(sync)}\n`)
    const result = await runCommand(sync, target)
    if (!result.ok) {
      throw new Error(
        `\`${result.command}\` failed in ${target}: ${result.warning ?? 'unknown error'}`,
      )
    }
    process.stdout.write('✅ Dependencies installed\n')
  }

  process.stdout.write('\n')
  if (skipInit) {
    process.stdout.write('⏭  Skipping `solvapay init` (--skip-init)\n')
  } else {
    await runInit({ cwd: target, options: { ...options, language }, skipSdkInstall: true })
  }

  await gitInit(target)

  const cli = `npx -y solvapay@${preview ? 'preview' : 'latest'}`
  const run = language === 'python' ? 'uv run python server.py' : 'go run .'
  const test = language === 'python' ? 'uv run pytest' : 'go test ./...'
  const steps = [
    '',
    '🎉 Done. Next steps:',
    `   cd ${projectName}`,
    ...(skipInstall ? [`   ${formatCommand(sync)}   # --skip-install was set`] : []),
    ...(skipInit
      ? [`   ${cli} init --language ${language}   # --skip-init was set; adds the key and product`]
      : []),
    `   ${run}   # MCP endpoint http://localhost:${LOCAL_PORT}/mcp`,
    `   ${test}`,
    `   ${cli} verify http://localhost:${LOCAL_PORT}/mcp`,
    `   # Edit ${language === 'python' ? 'tools.py' : 'tools.go'} to replace the placeholder tool ${toolName}.`,
    '   # MCP clients need a public HTTPS URL: start a tunnel (ngrok http 8080), set',
    '   # PUBLIC_BASE_URL in .env to it, and restart. To deploy, see README.md (Dockerfile).',
    '',
  ]
  process.stdout.write(steps.join('\n'))
}
