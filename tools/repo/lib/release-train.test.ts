import { describe, expect, it } from 'vitest'
import { REPO_ROOT } from '../../shared/paths.js'
import {
  changesetTouchesReleaseTrain,
  collectReleaseTrainDrift,
  prTouchesReleaseTrainSources,
  readReleaseTrainVersion,
  stampPyprojectDependency,
  stampRubyVersion,
  stampTomlPackageVersion,
} from './release-train.js'

describe('release-train stamping', () => {
  it('rewrites package and path-dep versions in Cargo.toml', () => {
    const input = `[package]
name = "solvapay-core"
version = "0.1.0"

[dependencies]
solvapay-export = { path = "../solvapay-export", version = "0.1.0" }
solvapay-mcp-core = { path = "../solvapay-mcp", version = "0.1.0", default-features = false, features = ["server"] }
`
    const stamped = stampTomlPackageVersion(input, '0.2.0')
    expect(stamped).toContain('version = "0.2.0"')
    expect(stamped).toContain(
      'solvapay-export = { path = "../solvapay-export", version = "0.2.0" }',
    )
    expect(stamped).toContain('version = "0.2.0", default-features = false')
    expect(stamped).not.toContain('version = "0.1.0"')
  })

  it('rewrites Ruby VERSION and Python solvapay pins', () => {
    expect(stampRubyVersion('module SolvaPay\n  VERSION = "0.1.0"\nend\n', '0.2.0')).toContain(
      'VERSION = "0.2.0"',
    )
    expect(stampPyprojectDependency('dependencies = [\n  "solvapay",\n]\n', '0.2.0')).toContain(
      '"solvapay==0.2.0"',
    )
    expect(
      stampPyprojectDependency('dependencies = [\n  "solvapay==0.1.0",\n]\n', '0.2.0'),
    ).toContain('"solvapay==0.2.0"')
  })
})

describe('release-train changeset gate', () => {
  it('requires a sentinel changeset when core or non-TypeScript SDK files change', () => {
    expect(prTouchesReleaseTrainSources(['core/solvapay-core/src/lib.rs'])).toBe(true)
    expect(prTouchesReleaseTrainSources(['sdks/python/src/client.rs'])).toBe(true)
    expect(prTouchesReleaseTrainSources(['sdks/ruby-mcp/lib/solvapay/mcp/engine.rb'])).toBe(true)
    expect(prTouchesReleaseTrainSources(['sdks/typescript/server/src/index.ts'])).toBe(false)
    expect(prTouchesReleaseTrainSources(['sdks/node-native/src/lib.rs'])).toBe(false)
    expect(prTouchesReleaseTrainSources(['docs/publishing.mdx'])).toBe(false)
  })

  it('detects a @solvapay/release-train changeset', () => {
    expect(changesetTouchesReleaseTrain(['---\n"@solvapay/core": patch\n---\n'])).toBe(false)
    expect(changesetTouchesReleaseTrain(['---\n"@solvapay/release-train": patch\n---\n'])).toBe(
      true,
    )
    expect(changesetTouchesReleaseTrain(["---\n'@solvapay/release-train': patch\n---\n"])).toBe(
      true,
    )
  })
})

describe('release-train live tree', () => {
  it('keeps language manifests on the sentinel version', () => {
    const version = readReleaseTrainVersion(REPO_ROOT)
    expect(version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(collectReleaseTrainDrift(REPO_ROOT, version)).toEqual([])
  })
})
