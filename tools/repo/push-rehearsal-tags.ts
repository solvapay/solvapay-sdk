#!/usr/bin/env tsx
/**
 * Push rehearsal/solvapay-<lang>-v<version> tags with the current HEAD.
 * Production tags are never created here.
 */

import { REPO_ROOT } from '../shared/paths.js'
import { git, listRemoteTagNames, localTagExists, pushTagsAtHead } from './lib/git-tags.js'
import { readReleaseTrainVersion } from './lib/release-train.js'
import { assertAllRehearsalTags, assertTagsAvailable, trainTags } from './lib/release-channel.js'

const replace = process.argv.includes('--replace')
const version = process.argv.includes('--version')
  ? process.argv[process.argv.indexOf('--version') + 1]
  : readReleaseTrainVersion(REPO_ROOT)

if (!version) {
  throw new Error('push-rehearsal-tags: version is required')
}

const tags = Object.values(trainTags(version, 'rehearsal'))
const remoteTags = listRemoteTagNames()

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

pushTagsAtHead(tags)
