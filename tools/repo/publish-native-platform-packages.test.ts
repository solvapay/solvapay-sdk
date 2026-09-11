import { describe, expect, it } from 'vitest'
import { REPO_ROOT } from '../shared/paths.js'
import { publishNativePlatformPackages } from './publish-native-platform-packages.js'

describe('publish-native-platform-packages', () => {
  it('skips a platform package whose version is already on the registry', async () => {
    const published: string[] = []
    const result = await publishNativePlatformPackages({
      repoRoot: REPO_ROOT,
      registry: 'https://registry.npmjs.org/',
      dryRun: false,
      versionExists: async name => name === '@solvapay/server-native-darwin-arm64',
      publish: ({ packageName }) => {
        published.push(packageName)
      },
    })
    expect(result.skipped).toContain('@solvapay/server-native-darwin-arm64')
    expect(published).not.toContain('@solvapay/server-native-darwin-arm64')
    expect(result.published.length + result.skipped.length).toBe(8)
  })

  it('publishes platform packages that are absent from the registry', async () => {
    const published: string[] = []
    const result = await publishNativePlatformPackages({
      repoRoot: REPO_ROOT,
      registry: 'https://registry.npmjs.org/',
      dryRun: true,
      versionExists: async () => false,
      publish: ({ packageName }) => {
        published.push(packageName)
      },
    })
    expect(result.skipped).toEqual([])
    expect(published).toHaveLength(8)
    expect(result.published).toEqual(published)
  })
})
