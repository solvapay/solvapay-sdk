import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseDotEnv } from './parse-dotenv.mjs'

const PLACEHOLDER = /your_|replace_me|sk_test_your|sk_live_your|prd_your/i

/**
 * @typedef {object} ArtifactCheck
 * @property {string} path
 * @property {string} hint
 */

/**
 * @typedef {object} DeployConfig
 * @property {string} cwd
 * @property {string[]} wranglerBin
 * @property {string} [wranglerEnv]
 * @property {string} workerName
 * @property {string} dotEnvFile
 * @property {string} [exampleFile]
 * @property {string} expectedPublicBaseUrl
 * @property {string[]} requiredVars
 * @property {string[]} overridableVars
 * @property {boolean} [requireApiDev]
 * @property {'dev' | 'prod'} [secretKeyMode]
 * @property {ArtifactCheck[]} [artifactChecks]
 * @property {(ctx: {
 *   env: Record<string, string> | null
 *   errors: string[]
 *   warnings: string[]
 *   spawn: typeof spawnSync
 *   cwd: string
 * }) => void} [extraPreflight]
 * @property {string[]} [postDeployNotes]
 * @property {string} label
 */

/**
 * @param {string[]} bin
 * @param {string[]} args
 */
export function wranglerArgs(bin, args) {
  return { cmd: bin[0], args: [...bin.slice(1), ...args] }
}

/**
 * @param {Record<string, string> | null | undefined} envFile
 * @param {NodeJS.ProcessEnv} [fallbackEnv]
 */
export function wranglerProcessEnv(envFile, fallbackEnv = process.env) {
  const accountId = (envFile?.CLOUDFLARE_ACCOUNT_ID ?? fallbackEnv.CLOUDFLARE_ACCOUNT_ID ?? '').trim()
  return accountId ? { ...fallbackEnv, CLOUDFLARE_ACCOUNT_ID: accountId } : fallbackEnv
}

/**
 * @param {DeployConfig} config
 */
export function secretPutCommand(config) {
  const { cmd, args } = wranglerArgs(config.wranglerBin, [
    'secret',
    'put',
    'SOLVAPAY_SECRET_KEY',
    ...(config.wranglerEnv ? ['--env', config.wranglerEnv] : []),
  ])
  return [cmd, ...args].join(' ')
}

/**
 * @param {DeployConfig} config
 * @param {{
 *   allowLive?: boolean
 *   allowSandbox?: boolean
 *   spawn?: typeof spawnSync
 *   exists?: typeof existsSync
 *   read?: typeof readFileSync
 * }} [opts]
 */
export function runPreflight(config, opts = {}) {
  const spawn = opts.spawn ?? spawnSync
  const exists = opts.exists ?? existsSync
  const read = opts.read ?? readFileSync
  const allowLive = opts.allowLive ?? false
  const allowSandbox = opts.allowSandbox ?? false

  const errors = []
  const warnings = []
  const dotEnvPath = resolve(config.cwd, config.dotEnvFile)
  const exampleFile = config.exampleFile ?? `${config.dotEnvFile}.example`

  /** @type {Record<string, string> | null} */
  let env = null
  if (!exists(dotEnvPath)) {
    errors.push(
      `${dotEnvPath} missing — copy ${exampleFile} to ${config.dotEnvFile} and fill in values`,
    )
  } else {
    env = parseDotEnv(read(dotEnvPath, 'utf8'))
    for (const key of config.requiredVars) {
      const value = env[key]?.trim()
      if (!value) {
        errors.push(`${key} is not set in ${config.dotEnvFile}`)
        continue
      }
      if (PLACEHOLDER.test(value)) {
        errors.push(`${key} still has a placeholder value in ${config.dotEnvFile}`)
      }
    }

    const secretKey = env.SOLVAPAY_SECRET_KEY ?? ''
    const mode = config.secretKeyMode ?? 'dev'
    if (mode === 'dev' && secretKey.startsWith('sk_live')) {
      const msg =
        'SOLVAPAY_SECRET_KEY looks like live — dev demo expects sk_test_… or sk_sandbox_…'
      if (allowLive) warnings.push(msg)
      else errors.push(`${msg}. Pass --allow-live to proceed anyway.`)
    }
    if (
      mode === 'prod' &&
      (secretKey.startsWith('sk_sandbox') || secretKey.startsWith('sk_test'))
    ) {
      const msg =
        'SOLVAPAY_SECRET_KEY looks like sandbox/test — prod demo expects sk_live_…'
      if (allowSandbox) warnings.push(msg)
      else errors.push(`${msg}. Pass --allow-sandbox to proceed anyway.`)
    }

    const publicUrl = env.MCP_PUBLIC_BASE_URL ?? ''
    if (publicUrl !== config.expectedPublicBaseUrl) {
      const msg = `MCP_PUBLIC_BASE_URL must be ${config.expectedPublicBaseUrl} (got ${publicUrl || '(empty)'})`
      if (mode === 'prod' && publicUrl) warnings.push(msg.replace('must be', 'is expected to be'))
      else errors.push(msg)
    }

    const apiBaseUrl = env.SOLVAPAY_API_BASE_URL ?? ''
    if (config.requireApiDev) {
      if (!apiBaseUrl.includes('api-dev')) {
        errors.push(
          `SOLVAPAY_API_BASE_URL must point at api-dev (got ${apiBaseUrl || '(empty)'})`,
        )
      }
      if (apiBaseUrl.includes('api.solvapay.com') && !apiBaseUrl.includes('api-dev')) {
        errors.push('SOLVAPAY_API_BASE_URL must not point at production api.solvapay.com')
      }
    } else if (mode === 'prod' && apiBaseUrl.includes('api-dev')) {
      warnings.push(
        'SOLVAPAY_API_BASE_URL points at api-dev — omit it for production api.solvapay.com',
      )
    }
  }

  for (const check of config.artifactChecks ?? []) {
    const artifactPath = resolve(config.cwd, check.path)
    if (!exists(artifactPath)) {
      errors.push(`${artifactPath} missing — ${check.hint}`)
    }
  }

  const wranglerEnv = wranglerProcessEnv(env)
  const whoami = wranglerArgs(config.wranglerBin, ['whoami'])
  const whoamiResult = spawn(whoami.cmd, whoami.args, {
    cwd: config.cwd,
    encoding: 'utf8',
    env: wranglerEnv,
  })
  if (whoamiResult.status !== 0) {
    errors.push(
      `wrangler is not authenticated — run \`${[config.wranglerBin[0], ...config.wranglerBin.slice(1), 'login'].join(' ')}\``,
    )
  }

  const secretList = wranglerArgs(config.wranglerBin, [
    'secret',
    'list',
    ...(config.wranglerEnv ? ['--env', config.wranglerEnv] : []),
  ])
  const secretListResult = spawn(secretList.cmd, secretList.args, {
    cwd: config.cwd,
    encoding: 'utf8',
    env: wranglerEnv,
  })
  if (secretListResult.status !== 0) {
    errors.push(`could not list Worker secrets on ${config.workerName} — check Cloudflare access`)
  } else if (!/SOLVAPAY_SECRET_KEY/.test(secretListResult.stdout ?? '')) {
    errors.push(
      `SOLVAPAY_SECRET_KEY secret not found on ${config.workerName} — run once:\n` +
        `  ${secretPutCommand(config)}`,
    )
  }

  config.extraPreflight?.({
    env,
    errors,
    warnings,
    spawn,
    cwd: config.cwd,
  })

  return { errors, warnings, env }
}

/**
 * @param {DeployConfig} config
 * @param {ReturnType<typeof runPreflight>} result
 */
export function formatPreflightReport(config, result) {
  const lines = [`${config.label} preflight`, '']
  if (result.warnings.length) {
    lines.push('Warnings:')
    for (const w of result.warnings) lines.push(`  ⚠  ${w}`)
    lines.push('')
  }
  if (result.errors.length) {
    lines.push('Blockers:')
    for (const e of result.errors) lines.push(`  ✗  ${e}`)
    lines.push('')
    lines.push('Fix the blockers above, then re-run preflight and deploy.')
    return lines.join('\n')
  }
  lines.push(`Ready to deploy ${config.label}.`)
  lines.push('')
  for (const note of config.postDeployNotes ?? []) {
    lines.push(note)
  }
  return lines.join('\n')
}

/**
 * @param {{ spawn?: typeof spawnSync }} [opts]
 */
export function dockerBuildxPreflight(opts = {}) {
  const spawn = opts.spawn ?? spawnSync
  /** @type {string[]} */
  const errors = []
  const docker = spawn('docker', ['info'], { encoding: 'utf8' })
  if (docker.status !== 0) {
    errors.push('Docker is not running — Cloudflare Containers need a local daemon to build images')
    return errors
  }
  const buildx = spawn('docker', ['buildx', 'version'], { encoding: 'utf8' })
  if (buildx.status !== 0) {
    errors.push('docker buildx is not available — required to build linux/amd64 container images')
  }
  return errors
}
