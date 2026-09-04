#!/usr/bin/env tsx
/**
 * Push rehearsal/solvapay-<lang>-v<version> tags with the current HEAD.
 * Production tags are never created here.
 */

import { execFileSync } from 'node:child_process'
import { REPO_ROOT } from '../shared/paths.js'
import { readReleaseTrainVersion } from './lib/release-train.js'
import { assertAllRehearsalTags, assertTagsAvailable, trainTags } from './lib/release-channel.js'

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim()
}

function localTagExists(tag: string): boolean {
  try {
    git(['show-ref', '--verify', '--quiet', `refs/tags/${tag}`])
    return true
  } catch {
    return false
  }
}

const replace = process.argv.includes('--replace')
const version = process.argv.includes('--version')
  ? process.argv[process.argv.indexOf('--version') + 1]
  : readReleaseTrainVersion(REPO_ROOT)

if (!version) {
  throw new Error('push-rehearsal-tags: version is required')
}

const tags = Object.values(trainTags(version, 'rehearsal'))
const remoteTags = git(['ls-remote', '--tags', 'origin'])
  .split('\n')
  .map(line => {
    const match = line.match(/refs\/tags\/(\S+)/)
    return match?.[1]?.replace(/\^\{\}$/, '') ?? ''
  })
  .filter(Boolean)

if (replace) {
  assertAllRehearsalTags(tags)
  for (const tag of tags) {
    if (remoteTags.includes(tag)) {
      git(['push', 'origin', '--delete', `refs/tags/${tag}`])
      console.log(`deleted remote ${tag}`)
    }
    if (localTagExists(tag)) {
      git(['tag', '-d', tag])
    }
  }
} else {
  assertTagsAvailable(tags, remoteTags)
}

const sha = git(['rev-parse', 'HEAD'])
for (const tag of tags) {
  git(['tag', tag, sha])
  git(['push', 'origin', `refs/tags/${tag}`])
  console.log(`pushed ${tag} -> ${sha}`)
}
