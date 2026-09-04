import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { WORKFLOWS_DIR } from '../shared/paths.js'
import { loadRepoPathsManifest } from '../shared/repo-paths.js'

function ciYml(): string {
  return readFileSync(path.join(WORKFLOWS_DIR, 'ci.yml'), 'utf8')
}

describe('ci.yml externalGenerated coverage', () => {
  it('does not use raw git diff on capi headers or the Go wasm blob', () => {
    const ci = ciYml()
    expect(ci).not.toMatch(/git diff --exit-code -- sdks\/capi\/include/)
    expect(ci).not.toMatch(/git diff --exit-code -- sdks\/go\/solvapay_core\.wasm/)
  })

  it('covers every externalGenerated id in exactly one --rebuild invocation', () => {
    const ci = ciYml()
    const ids = loadRepoPathsManifest().externalGenerated.map(entry => entry.id)
    const matches = [...ci.matchAll(/pnpm generated:external --rebuild --id ([^\s]+)/g)]
    const covered = matches.flatMap(match => (match[1] ?? '').split(',')).filter(Boolean)
    for (const id of ids) {
      expect(
        covered.filter(item => item === id),
        id,
      ).toHaveLength(1)
    }
    expect(covered).toHaveLength(ids.length)
  })

  it('does not run build:wasm immediately before build:check-drift', () => {
    const ci = ciYml()
    expect(ci).not.toMatch(/pnpm build:wasm\s*\n\s*pnpm build:check-drift/)
  })

  it('runs --markers-only in a job that does not set up Go or napi', () => {
    const ci = ciYml()
    expect(ci).toMatch(/pnpm generated:external --markers-only/)
    const jobs = ci.split(/\n  (?=[a-z0-9-]+:)/)
    const rust = jobs.find(block => block.startsWith('rust:'))
    expect(rust, 'rust job').toBeDefined()
    expect(rust).toMatch(/pnpm generated:external --markers-only/)
    expect(rust).not.toMatch(/setup-go@/)
    expect(rust).not.toMatch(/npx napi /)
  })

  it('runs gen:verify at the end of the rust job', () => {
    const ci = ciYml()
    expect(ci).toMatch(/pnpm gen:verify/)
    const jobs = ci.split(/\n  (?=[a-z0-9-]+:)/)
    const rust = jobs.find(block => block.startsWith('rust:'))
    expect(rust).toBeDefined()
    expect(rust).toMatch(/pnpm gen:verify/)
    const rustBody = rust ?? ''
    expect(rustBody.lastIndexOf('pnpm gen:verify')).toBeGreaterThan(
      rustBody.lastIndexOf('pnpm gen:check'),
    )
  })
})
