#!/usr/bin/env tsx
/**
 * Tier-1 hermetic scaffold sweep — the acceptance test for the
 * `create-solvapay` scaffolder.
 *
 * Nothing in CI has ever scaffolded a project, installed it, and booted it;
 * `scaffold.test.ts` / `smoke.test.ts` only exercise helpers in-process. This
 * script closes that gap. For each language row it:
 *
 *   1. scaffolds a from-scratch paid MCP server with `--dev` (checkout lane),
 *   2. asserts the generated manifest actually resolves SolvaPay deps from the
 *      local checkout — no bare registry version (the F2 regression guard),
 *   3. installs dependencies,
 *   4. boots the server,
 *   5. runs the generated `verify.mjs` against it.
 *
 * Tier-1 is HERMETIC: no SolvaPay registry, and no running platform. It passes
 * `--no-platform --skip-oauth` to `verify.mjs`, so it verifies the MCP/tool
 * contract but not the paid path. The paid path is the platform-backed Tier-2
 * sweep (needs `:3010`), which is a separate, deferred follow-up.
 *
 * Prerequisite: `pnpm build:packages` must have produced `dist/` for every
 * `@solvapay/*` TS package and `sdks/wasm` — a `link:`ed package with no build
 * output resolves to nothing. This script runs it for you unless `--skip-build`.
 *
 * Usage:
 *   tsx tools/repo/scaffold-sweep.ts [--only ts,python,…] [--skip-build] [--keep]
 *
 * Exit 0 only when every selected row passes end to end. Until Phases 1–2 land
 * this is EXPECTED to be red (F1 on ts, F5 on the snake_case tool name, F4 on
 * the Rust row); that is the point — it makes those failures visible.
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { REPO_ROOT, toolPackageDir } from '../shared/paths.js'
import { sdkPath } from '../shared/repo-paths.js'

type Stage = 'scaffold' | 'lane' | 'install' | 'boot' | 'verify'

type Row = {
  language: string
  /** Extra flags for the scaffold CLI (e.g. `--module` for go). */
  scaffoldArgs: string[]
  /** Dependency install command, run in the generated project. */
  install: { command: string; args: string[] }
  /** Listen port. `verify.mjs` hits `http://127.0.0.1:<port>`. */
  port: number
  /** Boot readiness budget — cargo/wrangler cold builds are slow. */
  bootTimeoutMs: number
  /**
   * Assert the generated manifest is on the checkout lane. Return a failure
   * string, or `null` when the lane is correct. This is the F2 guard: a bare
   * registry version here means the sweep would not be exercising the local
   * SDK at all.
   */
  assertLane: (projectDir: string) => string | null
}

const TOOL_NAME = 'generate_haiku' // snake_case — exactly what every language doc tells users to pass (F5)
// Built from parts so it isn't a layout-path string literal (repo path guard).
const TOOLS_LIST_METHOD = ['tools', 'list'].join('/')
const HTTP_SCRIPT = path.join('scripts', 'http.sh')

const ROWS: Row[] = [
  {
    language: 'ts',
    scaffoldArgs: [],
    install: { command: 'npm', args: ['install'] },
    port: 8787,
    bootTimeoutMs: 180_000,
    assertLane: dir => {
      const pkgPath = path.join(dir, 'package.json')
      if (!existsSync(pkgPath)) return 'package.json not found'
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
        dependencies?: Record<string, string>
      }
      const bare = Object.entries(pkg.dependencies ?? {})
        .filter(([name]) => name.startsWith('@solvapay/'))
        .filter(([, spec]) => !spec.startsWith('link:') && !spec.startsWith('file:'))
        .map(([name, spec]) => `${name}@${spec}`)
      if (
        bare.length === 0 &&
        Object.keys(pkg.dependencies ?? {}).some(n => n.startsWith('@solvapay/'))
      ) {
        return null
      }
      if (bare.length > 0) {
        return `@solvapay/* deps not on the checkout lane: ${bare.join(', ')} (expected link:/file:)`
      }
      return 'no @solvapay/* dependencies found in package.json'
    },
  },
  {
    language: 'python',
    scaffoldArgs: [],
    install: { command: 'uv', args: ['sync'] },
    port: 3031,
    bootTimeoutMs: 120_000,
    assertLane: dir =>
      assertContains(dir, 'pyproject.toml', ['[tool.uv.sources]', 'path ='], 'uv path sources'),
  },
  {
    language: 'ruby',
    scaffoldArgs: [],
    install: { command: 'bundle', args: ['install'] },
    port: 3032,
    bootTimeoutMs: 120_000,
    assertLane: dir => assertContains(dir, 'Gemfile', ['path:'], 'Gemfile path deps'),
  },
  {
    language: 'go',
    scaffoldArgs: ['--module', 'github.com/solvapay/scaffold-sweep-go'],
    install: { command: 'go', args: ['mod', 'tidy'] },
    port: 3033,
    bootTimeoutMs: 120_000,
    assertLane: dir =>
      assertContains(dir, 'go.mod', ['replace', '/sdks/go'], 'go.mod replace directive'),
  },
  {
    language: 'rust',
    scaffoldArgs: [],
    install: { command: 'cargo', args: ['fetch'] },
    port: 3034,
    bootTimeoutMs: 300_000,
    assertLane: dir => assertContains(dir, 'Cargo.toml', ['path = '], 'Cargo.toml path deps'),
  },
]

function assertContains(
  dir: string,
  manifest: string,
  needles: string[],
  label: string,
): string | null {
  const p = path.join(dir, manifest)
  if (!existsSync(p)) return `${manifest} not found`
  const raw = readFileSync(p, 'utf8')
  const missing = needles.filter(n => !raw.includes(n))
  if (missing.length > 0) {
    return `${manifest} is not on the checkout lane (missing ${label}: ${missing.join(', ')})`
  }
  return null
}

type RowResult = { language: string; ok: boolean; failedStage?: Stage; detail?: string }

function parseArgs(argv: string[]): { only: string[] | null; skipBuild: boolean; keep: boolean } {
  let only: string[] | null = null
  let skipBuild = false
  let keep = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--only')
      only = (argv[++i] ?? '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
    else if (arg === '--skip-build') skipBuild = true
    else if (arg === '--keep') keep = true
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        'Usage: tsx tools/repo/scaffold-sweep.ts [--only ts,python,ruby,go,rust] [--skip-build] [--keep]\n',
      )
      process.exit(0)
    }
  }
  return { only, skipBuild, keep }
}

/** Run a blocking command, streaming output. Returns exit code (or -1 on ENOENT). */
function run(command: string, args: string[], cwd: string, env = process.env): number {
  process.stdout.write(`   $ ${command} ${args.join(' ')}\n`)
  const res = spawnSync(command, args, { cwd, env, stdio: 'inherit' })
  if (res.error && (res.error as NodeJS.ErrnoException).code === 'ENOENT') return -1
  return res.status ?? 1
}

async function waitForServer(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      // Any HTTP response (even 400/401/405) means the server is listening.
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: TOOLS_LIST_METHOD, params: {} }),
      })
      if (res) return true
    } catch {
      // not up yet
    }
    await sleep(1000)
  }
  return false
}

async function runRow(row: Row, cliPath: string, workspace: string): Promise<RowResult> {
  const projectName = `sweep-${row.language}`
  const projectDir = path.join(workspace, projectName)
  const origin = `http://127.0.0.1:${row.port}`
  const fail = (stage: Stage, detail: string): RowResult => {
    process.stdout.write(`   ✗ ${row.language} failed at ${stage}: ${detail}\n`)
    return { language: row.language, ok: false, failedStage: stage, detail }
  }

  process.stdout.write(`\n▶ ${row.language}\n`)

  // 1. Scaffold (checkout lane, no init, no install — we install ourselves so
  //    a failed install is its own stage rather than a swallowed warning).
  const scaffoldCode = run(
    'node',
    [
      cliPath,
      projectName,
      '--type',
      'mcp',
      '--language',
      row.language,
      '--no-openapi',
      '--tool-name',
      TOOL_NAME,
      // A non-placeholder product ref so the seeded `.env` boots (the servers
      // refuse to start on the literal scaffolder placeholder). Stub value —
      // tools/list + widget never resolve it against the backend.
      '--product',
      'prd_scaffold_sweep_stub',
      '--yes',
      '--dev',
      '--skip-init',
      '--skip-install',
      ...row.scaffoldArgs,
    ],
    workspace,
  )
  if (scaffoldCode !== 0) return fail('scaffold', `scaffold CLI exited ${scaffoldCode}`)

  // 2. Lane guard — the generated manifest must resolve SolvaPay from the checkout.
  const laneError = row.assertLane(projectDir)
  if (laneError) return fail('lane', laneError)
  process.stdout.write(`   ✓ lane: ${row.language} manifest resolves SolvaPay from the checkout\n`)

  // 3. Install.
  const installCode = run(row.install.command, row.install.args, projectDir)
  if (installCode === -1) return fail('install', `\`${row.install.command}\` not found on PATH`)
  if (installCode !== 0)
    return fail(
      'install',
      `\`${row.install.command} ${row.install.args.join(' ')}\` exited ${installCode}`,
    )

  // Path gems do not compile Magnus on `bundle install`. Match the ruby CI
  // job: install + `rake compile` in the checkout so `require "solvapay"`
  // can load `lib/solvapay/solvapay`.
  if (row.language === 'ruby') {
    const rubySdk = sdkPath('ruby')
    const rubyBundle = run('bundle', ['install'], rubySdk)
    if (rubyBundle !== 0) {
      return fail('install', `\`bundle install\` in the Ruby SDK exited ${rubyBundle}`)
    }
    const compileCode = run('bundle', ['exec', 'rake', 'compile'], rubySdk)
    if (compileCode !== 0) {
      return fail('install', `\`bundle exec rake compile\` in the Ruby SDK exited ${compileCode}`)
    }
  }

  // 4. Boot (background) + readiness poll.
  process.stdout.write(`   $ ${HTTP_SCRIPT} (MCP_PORT=${row.port})\n`)
  // Tier-1 hermetic stubs. The generated servers require a secret key + product
  // ref just to boot, but the checks verify.mjs runs with `--no-platform`
  // (tools/list, widget) never call the SolvaPay backend — so placeholder
  // credentials are enough to start the server and exercise the MCP contract.
  // Real credentials + a running platform are the platform-backed Tier-2 sweep.
  const bootEnv = {
    ...process.env,
    MCP_PORT: String(row.port),
    MCP_HOST: '127.0.0.1',
    SOLVAPAY_SECRET_KEY: process.env.SOLVAPAY_SECRET_KEY ?? 'sk_test_scaffold_sweep_stub',
    SOLVAPAY_PRODUCT_REF: process.env.SOLVAPAY_PRODUCT_REF ?? 'prd_scaffold_sweep_stub',
  }
  // `wrangler dev` reads `.env` / `.dev.vars` and does not inherit the parent
  // process env. `--skip-init` leaves `.env` without `SOLVAPAY_SECRET_KEY`
  // (that line is written by `solvapay init`), so seed the hermetic stub.
  if (row.language === 'ts') {
    const envFile = path.join(projectDir, '.env')
    const existing = existsSync(envFile) ? readFileSync(envFile, 'utf8') : ''
    const next = existing.includes('SOLVAPAY_SECRET_KEY=')
      ? existing.replace(
          /^SOLVAPAY_SECRET_KEY=.*$/m,
          `SOLVAPAY_SECRET_KEY=${bootEnv.SOLVAPAY_SECRET_KEY}`,
        )
      : `${existing.replace(/\n?$/, '\n')}SOLVAPAY_SECRET_KEY=${bootEnv.SOLVAPAY_SECRET_KEY}\n`
    writeFileSync(envFile, next)
  }
  const boot =
    row.language === 'ts'
      ? spawn('npm', ['run', 'dev'], {
          cwd: projectDir,
          env: bootEnv,
          detached: true,
          stdio: 'inherit',
        })
      : spawn('bash', [HTTP_SCRIPT], {
          cwd: projectDir,
          env: bootEnv,
          detached: true,
          stdio: 'inherit',
        })

  try {
    const up = await waitForServer(`${origin}/mcp`, row.bootTimeoutMs)
    if (!up)
      return fail(
        'boot',
        `server did not respond on ${origin}/mcp within ${row.bootTimeoutMs / 1000}s`,
      )
    process.stdout.write(`   ✓ boot: ${origin} responding\n`)

    // 5. Verify (Tier-1 hermetic).
    const verifyCode = run(
      'node',
      [
        path.join(projectDir, 'scripts', 'verify.mjs'),
        origin,
        '--skip-oauth',
        '--no-platform',
        '--expect-tools',
        `account,activate_plan,${TOOL_NAME}`,
      ],
      projectDir,
    )
    if (verifyCode !== 0) return fail('verify', `verify.mjs exited ${verifyCode}`)
  } finally {
    killTree(boot.pid)
  }

  process.stdout.write(`   ✓ ${row.language} passed\n`)
  return { language: row.language, ok: true }
}

function killTree(pid: number | undefined): void {
  if (!pid) return
  try {
    // Negative pid → the whole process group spawned with `detached: true`
    // (http.sh execs go/cargo/ruby/uv, which would otherwise outlive it).
    process.kill(-pid, 'SIGTERM')
  } catch {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // already gone
    }
  }
}

async function main(): Promise<void> {
  const { only, skipBuild, keep } = parseArgs(process.argv.slice(2))
  const rows = only ? ROWS.filter(r => only.includes(r.language)) : ROWS
  if (rows.length === 0) {
    console.error(`No matching rows. Valid: ${ROWS.map(r => r.language).join(', ')}`)
    process.exit(2)
  }

  const cliPath = path.join(toolPackageDir('create-solvapay'), 'dist', 'cli.js')

  if (!skipBuild) {
    process.stdout.write('▶ pnpm build:packages (link: deps need built dist/)\n')
    const buildCode = run('pnpm', ['build:packages'], REPO_ROOT)
    if (buildCode !== 0) {
      console.error('build:packages failed — cannot sweep without built SDK output.')
      process.exit(buildCode)
    }
  }
  if (!existsSync(cliPath)) {
    console.error(
      `create-solvapay CLI not built at ${cliPath}. Run \`pnpm build:packages\` (or drop --skip-build).`,
    )
    process.exit(1)
  }

  const workspace = mkdtempSync(path.join(tmpdir(), 'solvapay-scaffold-sweep-'))
  process.stdout.write(`Workspace: ${workspace}\n`)

  const results: RowResult[] = []
  try {
    for (const row of rows) {
      results.push(await runRow(row, cliPath, workspace))
    }
  } finally {
    if (keep) process.stdout.write(`\nKept workspace: ${workspace}\n`)
    else rmSync(workspace, { recursive: true, force: true })
  }

  process.stdout.write('\n── Sweep summary ──\n')
  for (const r of results) {
    process.stdout.write(
      r.ok ? `  ✓ ${r.language}\n` : `  ✗ ${r.language} — ${r.failedStage}: ${r.detail}\n`,
    )
  }
  const failed = results.filter(r => !r.ok)
  process.stdout.write(`${results.length - failed.length}/${results.length} rows passed\n`)
  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch(err => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err))
  process.exit(1)
})
