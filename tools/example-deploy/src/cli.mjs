#!/usr/bin/env node
/* global console, process */

import { formatPreflightReport, runPreflight } from './preflight.mjs'
import { runDeploy } from './deploy.mjs'
import { loadConfig } from './load-config.mjs'

function parseCli(argv) {
  const args = [...argv]
  const command = args.shift()
  if (command !== 'preflight' && command !== 'deploy') {
    throw new Error('Usage: example-deploy <preflight|deploy> --config <file> [--target name]')
  }
  let configPath
  let target
  const passthrough = []
  let allowLive = false
  let allowSandbox = false
  while (args.length) {
    const arg = args.shift()
    if (arg === '--config') {
      configPath = args.shift()
      continue
    }
    if (arg === '--target') {
      target = args.shift()
      continue
    }
    if (arg === '--allow-live') {
      allowLive = true
      continue
    }
    if (arg === '--allow-sandbox') {
      allowSandbox = true
      continue
    }
    if (arg) passthrough.push(arg)
  }
  if (!configPath) {
    throw new Error('--config is required')
  }
  return { command, configPath, target, passthrough, allowLive, allowSandbox }
}

export { parseCli }

async function main() {
  const parsed = parseCli(process.argv.slice(2))
  const config = await loadConfig(parsed.configPath, parsed.target)
  if (parsed.command === 'preflight') {
    const result = runPreflight(config, {
      allowLive: parsed.allowLive,
      allowSandbox: parsed.allowSandbox,
    })
    console.log(formatPreflightReport(config, result))
    process.exit(result.errors.length ? 1 : 0)
  }
  const { status } = runDeploy(config, parsed.passthrough)
  process.exit(status)
}

const isDirect =
  process.argv[1] &&
  (process.argv[1].endsWith('cli.mjs') || process.argv[1].endsWith('example-deploy'))

if (isDirect) {
  main().catch(err => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
