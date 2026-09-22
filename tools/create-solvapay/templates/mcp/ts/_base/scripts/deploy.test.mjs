import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readOAuthTokenFromConfigPaths, wranglerConfigPaths } from './deploy.mjs'

describe('wranglerConfigPaths', () => {
  const originalWranglerHome = process.env.WRANGLER_HOME
  const originalXdg = process.env.XDG_CONFIG_HOME

  afterEach(() => {
    if (originalWranglerHome === undefined) delete process.env.WRANGLER_HOME
    else process.env.WRANGLER_HOME = originalWranglerHome
    if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = originalXdg
  })

  it('checks XDG_CONFIG_HOME after WRANGLER_HOME and before the macOS preferences path', () => {
    process.env.WRANGLER_HOME = '/tmp/wrangler-home'
    process.env.XDG_CONFIG_HOME = '/tmp/xdg-config'
    const paths = wranglerConfigPaths()
    expect(paths[0]).toBe('/tmp/wrangler-home/config/default.toml')
    expect(paths[1]).toBe('/tmp/xdg-config/.wrangler/config/default.toml')
    expect(paths[2]).toMatch(/Library\/Preferences\/\.wrangler\/config\/default\.toml$/)
  })
})

describe('readOAuthTokenFromConfigPaths', () => {
  const dirs = []

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  function writeConfig(token) {
    const dir = mkdtempSync(join(tmpdir(), 'wrangler-cfg-'))
    dirs.push(dir)
    mkdirSync(join(dir, 'config'), { recursive: true })
    const path = join(dir, 'config', 'default.toml')
    writeFileSync(path, token == null ? 'no_token = true\n' : `oauth_token = "${token}"\n`)
    return path
  }

  it('stops at the first config file that exists, even when it has no token', () => {
    const first = writeConfig(null)
    const second = writeConfig('from-later-file')
    expect(readOAuthTokenFromConfigPaths([first, second])).toBeNull()
  })

  it('reads the token from the first existing config file', () => {
    const missing = join(tmpdir(), 'does-not-exist-wrangler-config.toml')
    const found = writeConfig('from-xdg')
    expect(readOAuthTokenFromConfigPaths([missing, found])).toBe('from-xdg')
  })
})
