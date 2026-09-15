#!/usr/bin/env tsx
/**
 * Print GitHub Actions outputs for the release channel derived from a git ref.
 *
 *   pnpm exec tsx tools/repo/resolve-release-channel.ts \
 *     --ref refs/tags/rehearsal/solvapay-python-v0.2.0 \
 *     --run 7 \
 *     --remote-tags tag1,tag2
 */

import { appendFileSync } from 'node:fs'
import { readReleaseTrainVersion } from './lib/release-train.js'
import {
  assertHostMatchesChannel,
  assertTagsAvailable,
  ecosystemVersion,
  goModuleTag,
  parseReleaseTag,
  registryHost,
  resolveChannelFromRef,
  trainTags,
  type ReleaseChannel,
  type ReleaseEcosystem,
} from './lib/release-channel.js'
import { REPO_ROOT } from '../shared/paths.js'

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  if (index === -1) return undefined
  return process.argv[index + 1]
}

function writeOutput(name: string, value: string): void {
  const dest = process.env.GITHUB_OUTPUT
  const line = `${name}=${value}`
  if (dest) appendFileSync(dest, `${line}\n`)
  console.log(line)
}

const ref = argValue('--ref') ?? process.env.GITHUB_REF ?? ''
if (!ref) {
  throw new Error('resolve-release-channel: --ref or GITHUB_REF is required')
}

const runRaw = argValue('--run') ?? process.env.GITHUB_RUN_NUMBER ?? '1'
const runNumber = Number(runRaw)
const requested = argValue('--channel')
const channel: ReleaseChannel = requested
  ? (requested as ReleaseChannel)
  : resolveChannelFromRef(ref)

if (channel !== 'production' && channel !== 'rehearsal') {
  throw new Error(`resolve-release-channel: invalid channel ${channel}`)
}

const sentinel = argValue('--version') ?? readReleaseTrainVersion(REPO_ROOT)
const tags = trainTags(sentinel, channel)
const remoteTags = (argValue('--remote-tags') ?? '')
  .split(',')
  .map(t => t.trim())
  .filter(Boolean)
if (process.argv.includes('--assert-tags')) {
  assertTagsAvailable(Object.values(tags), remoteTags)
}

let languageVersion = sentinel
try {
  const parsed = parseReleaseTag(ref)
  languageVersion = parsed.version
} catch {
  // Branch / dispatch refs are not language tags; keep the sentinel version.
}

const ecosystem = (argValue('--ecosystem') ?? 'cargo') as ReleaseEcosystem
const host = registryHost(channel, ecosystem)
assertHostMatchesChannel(channel, ecosystem, host)

writeOutput('channel', channel)
writeOutput('sentinel', sentinel)
writeOutput('version', ecosystemVersion(languageVersion, channel, ecosystem, runNumber))
writeOutput('go_module_tag', goModuleTag(languageVersion, channel, runNumber))
writeOutput('host', host)
writeOutput('tag_rust', tags.rust)
writeOutput('tag_python', tags.python)
writeOutput('tag_ruby', tags.ruby)
writeOutput('tag_go', tags.go)
