import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { joinRoot } from './paths.js'

describe('cargo workspace layout', () => {
  it('has the workspace Cargo.toml at the repo root', () => {
    expect(existsSync(joinRoot('Cargo.toml'))).toBe(true)
    expect(existsSync(joinRoot('Cargo.lock'))).toBe(true)
    expect(existsSync(joinRoot('rust-toolchain.toml'))).toBe(true)
    expect(existsSync(joinRoot('.cargo/config.toml'))).toBe(true)
  })

  it('does not keep a nested rust workspace Cargo.toml', () => {
    expect(existsSync(path.join(joinRoot('rust'), 'Cargo.toml'))).toBe(false)
  })

  it('declares [workspace] on standalone example crates that are not workspace members', () => {
    const text = readFileSync(joinRoot('examples/rust/get-merchant/Cargo.toml'), 'utf8')
    expect(text).toMatch(/^\[workspace\]/m)
  })
})
