/**
 * `from-openapi` mode — build a sensible `selections.json` from the
 * spec, hand it to `scripts/scaffold.mjs` (which owns the per-spec
 * codegen), then run the install + `runInitInDirectory` postlude.
 *
 * The CLI auto-builds selections for the 80% case (every operation →
 * `suggestedTier`, top-level auth inferred from the first supported
 * scheme). Power users who need intent-driven clustering or per-op tier
 * decisions should run the scaffolder through Cursor / Claude Code with
 * the `solvapay/create-mcp-app` skill loaded.
 */

import { spawn } from 'node:child_process'
import { rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import readline from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { detectPackageManager, runInitInDirectory } from '@solvapay/init'
import type { InitCommandOptions } from '@solvapay/init'
import {
  assertTargetDirAbsent,
  deriveServerName,
  gitInit,
  installProjectDependencies,
  patchSolvapayVersions,
  PLACEHOLDERS,
  printConnectionSnippets,
  resolveLatestSolvapayVersions,
  SCAFFOLD_SCRIPT_PATH,
} from './scaffold'

export type FromOpenapiInput = {
  target: string
  projectName: string
  spec: string
  options: InitCommandOptions
  productRef?: string
  nonInteractive: boolean
  skipInstall?: boolean
  skipInit?: boolean
  /**
   * When true, seed `SOLVAPAY_API_BASE_URL=https://api-dev.solvapay.com`
   * into the scaffolded `.env` (via the `apiBaseUrl` field in
   * `selections.json`). Mirrors the from-scratch `dev` plumbing so
   * `wrangler dev` and `scripts/deploy.mjs` hit api-dev before
   * `solvapay init --dev` runs.
   */
  dev?: boolean
}

const DEV_API_BASE_URL = 'https://api-dev.solvapay.com'

type Selections = {
  workerName: string
  serverName: string
  mcpPublicBaseUrl: string
  solvapayProductRef?: string
  apiBaseUrl?: string
  mode: 'one-to-one'
  upstreamAuth:
    | { kind: 'none' }
    | { kind: 'bearer'; key: string }
    | { kind: 'apiKey'; in: 'header'; name: string; key: string }
    | {
        kind: 'oauth2-client-credentials'
        tokenUrl: string
        clientId: string
        clientSecret: string
        scope?: string
        audience?: string
      }
    | {
        kind: 'client-credentials-header'
        clientId: { headerName: string; value: string }
        clientSecret: { headerName: string; value: string }
      }
  operations: Array<{ operationId: string; tier: 'free' | 'paid' | 'skip' }>
}

export async function runFromOpenapi(input: FromOpenapiInput): Promise<void> {
  const {
    target,
    projectName,
    spec,
    options,
    productRef,
    nonInteractive,
    skipInstall,
    skipInit,
    dev,
  } = input

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
    serverName: deriveServerName(projectName),
    mcpPublicBaseUrl: 'http://localhost:8787',
    solvapayProductRef: productRef ?? PLACEHOLDERS.PRODUCT_REF,
    mode: 'one-to-one',
    upstreamAuth: authChoice,
    operations: operations.map((op: { operationId: string; suggestedTier: 'free' | 'paid' | 'skip' }) => ({
      operationId: op.operationId,
      tier: op.suggestedTier,
    })),
  }
  if (dev) {
    selections.apiBaseUrl = DEV_API_BASE_URL
  }

  const tmpSelectionsPath = join(
    tmpdir(),
    `create-solvapay-mcp-selections-${Date.now()}-${process.pid}.json`,
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

  process.stdout.write('🔄 Resolving latest @solvapay/* versions from npm registry…\n')
  const versionMap = await resolveLatestSolvapayVersions()
  await patchSolvapayVersions(target, versionMap)

  const packageManager = await detectPackageManager(target)
  if (skipInstall) {
    process.stdout.write('⏭  Skipping dependency install (--skip-install)\n')
  } else {
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
  }

  process.stdout.write('\n')
  if (skipInit) {
    process.stdout.write('⏭  Skipping `solvapay init` (--skip-init)\n')
  } else {
    await runInitInDirectory({ cwd: target, options, skipSdkInstall: true })
  }

  await gitInit(target)

  process.stdout.write(`\n🎉 Done. Next steps:\n`)
  process.stdout.write(`   cd ${projectName}\n`)
  if (skipInstall) {
    process.stdout.write(
      `   ${packageManager} install   # --skip-install was set; install before running dev\n`,
    )
  }
  if (skipInit) {
    process.stdout.write(
      `   npx -y solvapay@latest init   # --skip-init was set; run to wire up auth + product\n`,
    )
  }
  process.stdout.write(
    `   ${packageManager === 'npm' ? 'npm run' : packageManager} dev   # widget watch + wrangler dev on http://localhost:8787\n`,
  )

  printConnectionSnippets({ projectName })
}

async function chooseAuth(
  schemes: Array<{
    supported?: boolean
    kind?: string
    headerName?: string
    name?: string
    tokenUrl?: string
  }>,
  nonInteractive: boolean,
): Promise<Selections['upstreamAuth']> {
  const askValue = async (prompt: string, authLabel: string): Promise<string> => {
    if (nonInteractive) {
      throw new Error(
        `Spec requires upstream auth (${authLabel}); pass --non-interactive only after ` +
          `setting the upstream secret(s) in the generated .env. Run interactively for the guided flow.`,
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

  // A client-id + client-secret pair sent as two static headers (no token
  // exchange). Detected when the spec declares exactly two supported
  // header apiKey schemes that disambiguate into an id and a secret. Try
  // this before the single-scheme path so we don't collapse the pair into
  // one header.
  const pair = detectClientCredentialsHeaderPair(schemes)
  if (pair) {
    process.stdout.write(
      `Spec requires a client-id + client-secret header pair ` +
        `(${pair.idHeader} + ${pair.secretHeader}).\n`,
    )
    const idValue = await askValue(
      `Client ID header value for ${pair.idHeader} (blank = skip): `,
      'client-credentials-header',
    )
    if (!idValue) return { kind: 'none' }
    const secretValue = await askValue(
      `Client secret header value for ${pair.secretHeader}: `,
      'client-credentials-header',
    )
    if (!secretValue) return { kind: 'none' }
    return {
      kind: 'client-credentials-header',
      clientId: { headerName: pair.idHeader, value: idValue },
      clientSecret: { headerName: pair.secretHeader, value: secretValue },
    }
  }

  const firstSupported = schemes.find(
    s =>
      s.supported === true &&
      (s.kind === 'http-bearer' ||
        s.kind === 'apiKey-header' ||
        s.kind === 'oauth2-clientCredentials'),
  )
  if (!firstSupported) {
    return { kind: 'none' }
  }

  if (firstSupported.kind === 'http-bearer') {
    const key = await askValue(
      'Spec requires bearer auth. Paste the upstream API key (skips into .env, blank = skip): ',
      'http-bearer',
    )
    if (!key) return { kind: 'none' }
    return { kind: 'bearer', key }
  }

  if (firstSupported.kind === 'apiKey-header') {
    const headerName = firstSupported.headerName ?? 'X-API-Key'
    const key = await askValue(
      `Spec requires apiKey auth (${headerName}). Paste the upstream API key (blank = skip): `,
      'apiKey-header',
    )
    if (!key) return { kind: 'none' }
    return { kind: 'apiKey', in: 'header', name: headerName, key }
  }

  // oauth2-clientCredentials. `tokenUrl` comes from the spec; the
  // user supplies `client_id` and `client_secret`. `scope` / `audience`
  // are optional and skipped when blank.
  const tokenUrl = firstSupported.tokenUrl
  if (!tokenUrl) return { kind: 'none' }
  process.stdout.write(
    `Spec requires OAuth 2.0 client_credentials (token endpoint ${tokenUrl}).\n`,
  )
  const clientId = await askValue('OAuth client_id (blank = skip OAuth setup): ', 'oauth2-client-credentials')
  if (!clientId) return { kind: 'none' }
  const clientSecret = await askValue('OAuth client_secret: ', 'oauth2-client-credentials')
  if (!clientSecret) return { kind: 'none' }
  const scope = await askValue(
    'OAuth scope (optional, space-delimited; press Enter to skip): ',
    'oauth2-client-credentials',
  )
  const audience = await askValue(
    'OAuth audience (optional, e.g. Auth0 audience; press Enter to skip): ',
    'oauth2-client-credentials',
  )
  const auth: Extract<Selections['upstreamAuth'], { kind: 'oauth2-client-credentials' }> = {
    kind: 'oauth2-client-credentials',
    tokenUrl,
    clientId,
    clientSecret,
  }
  if (scope) auth.scope = scope
  if (audience) auth.audience = audience
  return auth
}

/**
 * Detect a client-id + client-secret header pair: exactly two supported
 * `apiKey-header` schemes that disambiguate into an identifier and a secret.
 *
 * Disambiguation is by name — the scheme whose header (or scheme key) reads
 * like a "secret" is the secret; the other is the id. When the two can't be
 * told apart (both or neither look like a secret), returns `null` so the
 * caller falls back to the single-scheme path rather than guessing which
 * credential is which.
 */
export function detectClientCredentialsHeaderPair(
  schemes: Array<{ supported?: boolean; kind?: string; headerName?: string; name?: string }>,
): { idHeader: string; secretHeader: string } | null {
  const headerSchemes = schemes.filter(s => s.supported === true && s.kind === 'apiKey-header')
  if (headerSchemes.length !== 2) return null
  const looksLikeSecret = (s: { headerName?: string; name?: string }): boolean =>
    /secret/i.test(s.headerName ?? '') || /secret/i.test(s.name ?? '')
  const secrets = headerSchemes.filter(looksLikeSecret)
  const ids = headerSchemes.filter(s => !looksLikeSecret(s))
  if (secrets.length !== 1 || ids.length !== 1) return null
  const idHeader = ids[0].headerName
  const secretHeader = secrets[0].headerName
  if (!idHeader || !secretHeader) return null
  return { idHeader, secretHeader }
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
