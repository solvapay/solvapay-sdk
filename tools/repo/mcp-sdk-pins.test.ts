import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  EXAMPLES_DIR,
  REPO_ROOT,
  WORKFLOWS_DIR,
  joinRel,
  lookupRel,
  joinRoot,
  toolPackageDir,
  tsPackageDir,
} from '../shared/paths.js'
import { sdkPath } from '../shared/repo-paths.js'
import { fetchLatestMcpPins, goToolchainMinor } from './lib/mcp-pins.js'

const GO_SDK_MOD = 'github.com/modelcontextprotocol/go-sdk'
const NPM_CORE = '@modelcontextprotocol/core'
const NPM_SERVER = '@modelcontextprotocol/server'
const NPM_NODE = '@modelcontextprotocol/node'
const NPM_EXT_APPS = '@modelcontextprotocol/ext-apps'

type SemverTriple = readonly [number, number, number]

function posixRel(abs: string): string {
  return path.relative(REPO_ROOT, abs).split(path.sep).join('/')
}

function read(file: string): string {
  if (!existsSync(file)) {
    throw new Error(`missing ${posixRel(file)}`)
  }
  return readFileSync(file, 'utf8')
}

function parseSemver(raw: string): SemverTriple {
  const cleaned = raw.replace(/^v/, '')
  const match = cleaned.match(/^(\d+)\.(\d+)\.(\d+)/)
  if (
    match === null ||
    match[1] === undefined ||
    match[2] === undefined ||
    match[3] === undefined
  ) {
    throw new Error(`not a semver: ${raw}`)
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function cmpSemver(a: SemverTriple, b: SemverTriple): number {
  for (let i = 0; i < 3; i += 1) {
    const left = a[i] ?? 0
    const right = b[i] ?? 0
    if (left !== right) {
      return left < right ? -1 : 1
    }
  }
  return 0
}

function gte(version: string, bound: string): boolean {
  return cmpSemver(parseSemver(version), parseSemver(bound)) >= 0
}

function lt(version: string, bound: string): boolean {
  return cmpSemver(parseSemver(version), parseSemver(bound)) < 0
}

/** npm caret / exact / `>=x,<y` (comma or space). */
function npmRangeAdmits(range: string, version: string): boolean {
  const trimmed = range.trim()
  if (/^\d+\.\d+\.\d+$/.test(trimmed)) {
    return trimmed === version
  }
  const caret = trimmed.match(/^\^(\d+\.\d+\.\d+)$/)
  if (caret?.[1] !== undefined) {
    const floor = caret[1]
    const [maj] = parseSemver(floor)
    return gte(version, floor) && lt(version, `${maj + 1}.0.0`)
  }
  const geLt = trimmed.match(/^>=\s*(\d+\.\d+\.\d+)\s*,?\s*<\s*(\d+(?:\.\d+\.\d+)?)$/)
  if (geLt?.[1] !== undefined && geLt[2] !== undefined) {
    const upper = geLt[2].includes('.') ? geLt[2] : `${geLt[2]}.0.0`
    return gte(version, geLt[1]) && lt(version, upper)
  }
  return false
}

function npmRangeFloor(range: string): string | undefined {
  const trimmed = range.trim()
  if (/^\d+\.\d+\.\d+$/.test(trimmed)) {
    return trimmed
  }
  const caret = trimmed.match(/^\^(\d+\.\d+\.\d+)$/)
  return caret?.[1]
}

/** Ruby `~> 1.3` is `>= 1.3.0 < 2.0.0`; `~> 1.3.0` is `>= 1.3.0 < 1.4.0`. */
function rubyPessimisticAdmits(constraint: string, version: string): boolean {
  const match = constraint.trim().match(/^~>\s*(\d+)\.(\d+)(?:\.(\d+))?$/)
  if (match?.[1] === undefined || match?.[2] === undefined) {
    return false
  }
  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = match[3]
  if (patch === undefined) {
    return gte(version, `${major}.${minor}.0`) && lt(version, `${major + 1}.0.0`)
  }
  return gte(version, `${major}.${minor}.${patch}`) && lt(version, `${major}.${minor + 1}.0`)
}

function parseGoMod(src: string): { toolchain: string | undefined; goSdk: string | undefined } {
  const toolchain = src.match(/^go\s+(\S+)/m)?.[1]
  const requireLine = src
    .split('\n')
    .find(line => line.includes(GO_SDK_MOD) && !line.includes('// indirect'))
  const goSdk = requireLine?.match(/v\d+\.\d+\.\d+/)?.[0]
  return { toolchain, goSdk }
}

function extractDenoNpmVersion(spec: string, pkg: string): string | undefined {
  const escaped = pkg.replace('/', '\\/')
  const match = spec.match(new RegExp(`${escaped}@(\\^?\\d+\\.\\d+\\.\\d+)`))
  return match?.[1]
}

function jsonObject(file: string): Record<string, unknown> {
  const raw: unknown = JSON.parse(read(file))
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`${posixRel(file)}: expected a JSON object`)
  }
  return raw as Record<string, unknown>
}

function depGroups(pkg: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of ['dependencies', 'devDependencies', 'peerDependencies'] as const) {
    const group = pkg[key]
    if (typeof group !== 'object' || group === null || Array.isArray(group)) {
      continue
    }
    for (const [name, spec] of Object.entries(group as Record<string, unknown>)) {
      if (typeof spec === 'string') {
        out[name] = spec
      }
    }
  }
  return out
}

function pnpmResolvedVersions(lock: string, pkg: string): string[] {
  const versions = new Set<string>()
  const re = new RegExp(`['"]${pkg.replace('/', '\\/')}@(\\d+\\.\\d+\\.\\d+)`, 'g')
  let match: RegExpExecArray | null
  while ((match = re.exec(lock)) !== null) {
    if (match[1] !== undefined) {
      versions.add(match[1])
    }
  }
  return [...versions].sort()
}

function lockfilePackageVersion(lock: string, name: string): string | undefined {
  const match = lock.match(new RegExp(`^name = "${name}"\\nversion = "([^"]+)"`, 'm'))
  return match?.[1]
}

function gemLockResolved(lock: string, name: string): string | undefined {
  const match = lock.match(new RegExp(`^    ${name} \\((\\d+\\.\\d+\\.\\d+)\\)\\s*$`, 'm'))
  return match?.[1]
}

function cargoTomlRmcpVersion(src: string): string | undefined {
  const match = src.match(/rmcp\s*=\s*\{\s*version\s*=\s*"([^"]+)"/)
  return match?.[1]
}

describe('MCP host-SDK pins', () => {
  it('matches the latest published host SDK at every declaration and lockfile site', async () => {
    const pins = await fetchLatestMcpPins()
    const violations: string[] = []
    const toolchainMinor = goToolchainMinor(pins.goToolchain)

    const goModules: Array<{ file: string; requireGoSdk: boolean }> = [
      { file: joinRel(sdkPath('go'), 'go.mod'), requireGoSdk: true },
      { file: joinRel(EXAMPLES_DIR, 'go', 'weather-mcp', 'go.mod'), requireGoSdk: true },
    ]
    for (const { file, requireGoSdk } of goModules) {
      const parsed = parseGoMod(read(file))
      const rel = posixRel(file)
      if (parsed.toolchain !== pins.goToolchain) {
        violations.push(`${rel}: go ${parsed.toolchain ?? '(missing)'} !== ${pins.goToolchain}`)
      }
      if (requireGoSdk && parsed.goSdk !== pins.goSdk) {
        violations.push(`${rel}: ${GO_SDK_MOD} ${parsed.goSdk ?? '(missing)'} !== ${pins.goSdk}`)
      }
      if (!requireGoSdk && parsed.goSdk !== undefined) {
        violations.push(`${rel}: unexpected direct ${GO_SDK_MOD} ${parsed.goSdk}`)
      }
    }

    const workflowFiles = ['ci.yml', 'live-go.yml', 'publish-go.yml']
    for (const name of workflowFiles) {
      const file = joinRel(WORKFLOWS_DIR, name)
      const src = read(file)
      const rel = posixRel(file)
      const pins = [...src.matchAll(/go-version:\s*'([^']+)'/g)].map(m => m[1])
      if (pins.length === 0) {
        violations.push(`${rel}: no go-version pin`)
      }
      for (const pin of pins) {
        if (pin !== toolchainMinor) {
          violations.push(`${rel}: go-version '${pin}' !== '${toolchainMinor}'`)
        }
      }
    }

    const ciYml = read(joinRel(WORKFLOWS_DIR, 'ci.yml'))
    const synthetic = ciYml.match(/'go\s+(\d+\.\d+(?:\.\d+)?)'/)
    if (synthetic?.[1] !== toolchainMinor) {
      violations.push(
        `${posixRel(joinRel(WORKFLOWS_DIR, 'ci.yml'))}: synthetic go ${synthetic?.[1] ?? '(missing)'} !== ${toolchainMinor}`,
      )
    }

    const publishedNpm = [
      { file: joinRel(tsPackageDir('mcp'), 'package.json'), floorExact: new Set<string>() },
      { file: joinRel(REPO_ROOT, 'package.json'), floorExact: new Set<string>() },
    ]
    const exampleNpm = [
      'mcp-time-app',
      'cloudflare-workers-mcp',
      'mcp-checkout-app',
      'supabase-edge-mcp',
      'mcp-oauth-bridge',
    ].map(name => ({
      file: joinRel(EXAMPLES_DIR, 'typescript', name, 'package.json'),
      floorExact: new Set([NPM_EXT_APPS]),
    }))
    const toolNpm = [
      {
        file: joinRel(path.dirname(joinRoot(lookupRel('mcpAppWidgetCanonical'))), 'package.json'),
        floorExact: new Set([NPM_EXT_APPS]),
      },
      {
        file: joinRel(
          toolPackageDir('create-solvapay'),
          'templates',
          'mcp',
          '_base',
          'package.json',
        ),
        floorExact: new Set([NPM_EXT_APPS]),
      },
    ]
    const npmTargets: Record<string, string> = {
      [NPM_CORE]: pins.npmCore,
      [NPM_SERVER]: pins.npmServer,
      [NPM_NODE]: pins.npmNode,
      [NPM_EXT_APPS]: pins.npmExtApps,
    }
    for (const { file, floorExact } of [...publishedNpm, ...exampleNpm, ...toolNpm]) {
      const deps = depGroups(jsonObject(file))
      const rel = posixRel(file)
      for (const [pkg, target] of Object.entries(npmTargets)) {
        const spec = deps[pkg]
        if (spec === undefined) {
          continue
        }
        if (floorExact.has(pkg)) {
          const floor = npmRangeFloor(spec)
          if (floor !== target) {
            violations.push(`${rel}: ${pkg} ${spec} floor ${floor ?? '(none)'} !== ${target}`)
          }
        } else if (!npmRangeAdmits(spec, target)) {
          violations.push(`${rel}: ${pkg} ${spec} does not admit ${target}`)
        }
      }
    }

    const denoMaps = [
      {
        file: joinRel(EXAMPLES_DIR, 'typescript', 'supabase-edge-mcp', 'deno.workspace.json'),
        exact: true,
      },
      {
        file: joinRel(
          EXAMPLES_DIR,
          'typescript',
          'supabase-edge-mcp',
          'supabase',
          'functions',
          'mcp',
          'deno.json',
        ),
        exact: false,
      },
      {
        file: joinRel(
          EXAMPLES_DIR,
          'typescript',
          'supabase-edge-mcp',
          'supabase',
          'functions',
          'mcp',
          'deno.local.json',
        ),
        exact: false,
      },
    ]
    for (const { file, exact } of denoMaps) {
      const json = jsonObject(file)
      const imports = json.imports
      if (typeof imports !== 'object' || imports === null || Array.isArray(imports)) {
        violations.push(`${posixRel(file)}: missing imports map`)
        continue
      }
      const rel = posixRel(file)
      for (const [pkg, target] of Object.entries(npmTargets)) {
        for (const [key, spec] of Object.entries(imports as Record<string, unknown>)) {
          if (typeof spec !== 'string' || !key.startsWith(pkg)) {
            continue
          }
          const extracted = extractDenoNpmVersion(spec, pkg)
          if (extracted === undefined) {
            violations.push(`${rel}: ${key} has no version`)
            continue
          }
          if (exact || !extracted.startsWith('^')) {
            if (extracted !== target) {
              violations.push(`${rel}: ${key} ${extracted} !== ${target}`)
            }
          } else if (pkg === NPM_EXT_APPS) {
            const floor = npmRangeFloor(extracted)
            if (floor !== target) {
              violations.push(
                `${rel}: ${key} ${extracted} floor ${floor ?? '(none)'} !== ${target}`,
              )
            }
          } else if (!npmRangeAdmits(extracted, target)) {
            violations.push(`${rel}: ${key} ${extracted} does not admit ${target}`)
          }
        }
      }
    }

    const pythonToml = read(joinRel(sdkPath('pythonMcp'), 'pyproject.toml'))
    const pythonRange = pythonToml.match(/"mcp([^"]+)"/)?.[1]
    if (pythonRange === undefined || !npmRangeAdmits(pythonRange, pins.pythonMcp)) {
      violations.push(
        `${posixRel(joinRel(sdkPath('pythonMcp'), 'pyproject.toml'))}: mcp ${pythonRange ?? '(missing)'} does not admit ${pins.pythonMcp}`,
      )
    }

    const gemspec = read(joinRel(sdkPath('rubyMcp'), 'solvapay-mcp.gemspec'))
    const gemspecRange = gemspec.match(/add_dependency\s+"mcp",\s+"([^"]+)"/)?.[1]
    if (gemspecRange === undefined || !rubyPessimisticAdmits(gemspecRange, pins.rubyMcp)) {
      violations.push(
        `${posixRel(joinRel(sdkPath('rubyMcp'), 'solvapay-mcp.gemspec'))}: mcp ${gemspecRange ?? '(missing)'} does not admit ${pins.rubyMcp}`,
      )
    }
    const gemfile = read(joinRel(sdkPath('rubyMcp'), 'Gemfile'))
    const gemfileRange = gemfile.match(/gem\s+"mcp",\s+"([^"]+)"/)?.[1]
    if (gemfileRange === undefined || !rubyPessimisticAdmits(gemfileRange, pins.rubyMcp)) {
      violations.push(
        `${posixRel(joinRel(sdkPath('rubyMcp'), 'Gemfile'))}: mcp ${gemfileRange ?? '(missing)'} does not admit ${pins.rubyMcp}`,
      )
    }

    const rootCargo = read(joinRel(REPO_ROOT, 'Cargo.toml'))
    const rootRmcp = cargoTomlRmcpVersion(rootCargo)
    if (rootRmcp !== pins.rustRmcp) {
      violations.push(
        `${posixRel(joinRel(REPO_ROOT, 'Cargo.toml'))}: rmcp ${rootRmcp ?? '(missing)'} !== ${pins.rustRmcp}`,
      )
    }

    const pnpmLock = read(joinRel(REPO_ROOT, 'pnpm-lock.yaml'))
    for (const [pkg, target] of Object.entries(npmTargets)) {
      const resolved = pnpmResolvedVersions(pnpmLock, pkg)
      if (resolved.length === 0) {
        if (pkg === NPM_NODE || pkg === NPM_EXT_APPS || pkg === NPM_CORE || pkg === NPM_SERVER) {
          violations.push(`pnpm-lock.yaml: no resolved ${pkg}`)
        }
        continue
      }
      if (resolved.length !== 1 || resolved[0] !== target) {
        violations.push(`pnpm-lock.yaml: ${pkg} resolved [${resolved.join(', ')}] !== ${target}`)
      }
    }

    const uvLock = read(joinRel(sdkPath('pythonMcp'), 'uv.lock'))
    const uvMcp = lockfilePackageVersion(uvLock, 'mcp')
    if (uvMcp !== pins.pythonMcp) {
      violations.push(
        `${posixRel(joinRel(sdkPath('pythonMcp'), 'uv.lock'))}: mcp ${uvMcp ?? '(missing)'} !== ${pins.pythonMcp}`,
      )
    }

    const gemLock = read(joinRel(sdkPath('rubyMcp'), 'Gemfile.lock'))
    const gemResolved = gemLockResolved(gemLock, 'mcp')
    if (gemResolved !== pins.rubyMcp) {
      violations.push(
        `${posixRel(joinRel(sdkPath('rubyMcp'), 'Gemfile.lock'))}: mcp ${gemResolved ?? '(missing)'} !== ${pins.rubyMcp}`,
      )
    }

    const cargoLock = read(joinRel(REPO_ROOT, 'Cargo.lock'))
    const rmcpLock = lockfilePackageVersion(cargoLock, 'rmcp')
    if (rmcpLock !== pins.rustRmcp) {
      violations.push(
        `${posixRel(joinRel(REPO_ROOT, 'Cargo.lock'))}: rmcp ${rmcpLock ?? '(missing)'} !== ${pins.rustRmcp}`,
      )
    }

    expect(violations).toEqual([])
  }, 30_000)
})
