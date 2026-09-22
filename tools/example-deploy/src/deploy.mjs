import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseDotEnv } from './parse-dotenv.mjs'
import { wranglerArgs, wranglerProcessEnv } from './preflight.mjs'

/**
 * @param {import('./preflight.mjs').DeployConfig} config
 * @param {string[]} passthrough
 * @param {{
 *   spawn?: typeof spawnSync
 *   exists?: typeof existsSync
 *   read?: typeof readFileSync
 *   log?: (msg: string) => void
 * }} [opts]
 */
export function runDeploy(config, passthrough = [], opts = {}) {
  const spawn = opts.spawn ?? spawnSync
  const exists = opts.exists ?? existsSync
  const read = opts.read ?? readFileSync
  const log = opts.log ?? (msg => console.error(msg))

  const dotEnvPath = resolve(config.cwd, config.dotEnvFile)
  const localEnv = exists(dotEnvPath) ? parseDotEnv(read(dotEnvPath, 'utf8')) : {}

  if (!exists(dotEnvPath)) {
    const wranglerEnvNote = config.wranglerEnv ? ` [env.${config.wranglerEnv}]` : ''
    const exampleFile = config.exampleFile ?? `${config.dotEnvFile}.example`
    log(
      [
        '',
        `⚠  ${dotEnvPath} not found — deploying with placeholder vars`,
        `   from wrangler.jsonc${wranglerEnvNote}.`,
        `   Copy ${exampleFile} to ${config.dotEnvFile} and fill in your`,
        '   values to override the committed placeholders at deploy time.',
        '',
      ].join('\n'),
    )
  }

  const deployArgs = ['deploy']
  if (config.wranglerEnv) deployArgs.push('--env', config.wranglerEnv)
  for (const name of config.overridableVars) {
    const value = localEnv[name]
    if (value) deployArgs.push('--var', `${name}:${value}`)
  }
  deployArgs.push(...passthrough)

  const { cmd, args } = wranglerArgs(config.wranglerBin, deployArgs)
  const childEnv = wranglerProcessEnv(localEnv)
  const result = spawn(cmd, args, {
    cwd: config.cwd,
    stdio: opts.spawn ? 'pipe' : 'inherit',
    encoding: 'utf8',
    env: childEnv,
  })
  return { status: result.status ?? 1, args: [cmd, ...args] }
}
