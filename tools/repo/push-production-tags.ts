#!/usr/bin/env tsx
/**
 * After a real @solvapay/release-train bump on main, push
 * solvapay-<lang>-v<sentinel> for languages enabled by RELEASE_PROD_*.
 * Never uses --replace.
 */

import { REPO_ROOT } from '../shared/paths.js'
import { git, listRemoteTagNames, pushTagsAtHead } from './lib/git-tags.js'
import {
  enabledProductionLanguages,
  productionTagsToPush,
  sentinelMoved,
} from './lib/production-tags.js'
import { assertTagsAvailable, parseSemver } from './lib/release-channel.js'
import { RELEASE_TRAIN_PACKAGE_REL, readReleaseTrainVersion } from './lib/release-train.js'

function firstParentSentinelVersion(): string {
  const raw: unknown = JSON.parse(git(['show', `HEAD^:${RELEASE_TRAIN_PACKAGE_REL}`]))
  if (
    typeof raw !== 'object' ||
    raw === null ||
    !('version' in raw) ||
    typeof raw.version !== 'string'
  ) {
    throw new Error(
      `push-production-tags: HEAD^:${RELEASE_TRAIN_PACKAGE_REL} is not a valid package.json`,
    )
  }
  return parseSemver(raw.version)
}

const version = parseSemver(readReleaseTrainVersion(REPO_ROOT))
const previous = firstParentSentinelVersion()

if (!sentinelMoved(version, previous)) {
  console.log(`push-production-tags: sentinel unchanged at ${version}; skipping tags`)
  process.exit(0)
}

const languages = enabledProductionLanguages(process.env)
if (languages.length === 0) {
  console.log(
    `push-production-tags: sentinel moved ${previous} -> ${version}; no RELEASE_PROD_* language enabled`,
  )
  process.exit(0)
}

const tags = productionTagsToPush(version, languages)
assertTagsAvailable(tags, listRemoteTagNames())
pushTagsAtHead(tags)
