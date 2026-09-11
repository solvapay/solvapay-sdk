/**
 * Live latest versions of each language's native MCP host SDK.
 * `mcp-sdk-pins.test.ts` fetches these and asserts every declaration
 * and lockfile agrees. Cross-package major drift for the npm MCP
 * packages is also covered by `check-dependency-health.ts`.
 *
 * Fetch failures throw — no hardcoded fallback versions.
 */

export const GO_SDK_MODULE = 'github.com/modelcontextprotocol/go-sdk'

export type McpPins = {
  goSdk: string
  goToolchain: string
  npmCore: string
  npmServer: string
  npmNode: string
  npmExtApps: string
  pythonMcp: string
  rubyMcp: string
  rustRmcp: string
}

export type FetchLike = (
  input: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<Response>

const FETCH_TIMEOUT_MS = 15_000
const USER_AGENT = 'solvapay-sdk-mcp-pin-check (https://github.com/solvapay/solvapay-sdk)'

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label}: expected a non-empty string`)
  }
  return value
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label}: expected a JSON object`)
  }
  return value as Record<string, unknown>
}

async function getOk(
  load: FetchLike,
  url: string,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const response = await load(url, {
    headers: { accept: 'application/json', 'user-agent': USER_AGENT, ...extraHeaders },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`GET ${url} -> ${response.status} ${response.statusText}`)
  }
  return response
}

async function getJson(load: FetchLike, url: string): Promise<unknown> {
  return (await getOk(load, url)).json()
}

export function parseGoLatest(body: unknown): string {
  return requireString(asRecord(body, 'go-sdk @latest').Version, 'go-sdk Version')
}

export function parseGoToolchain(mod: string): string {
  const toolchain = mod.match(/^go\s+(\S+)/m)?.[1]
  if (toolchain === undefined) {
    throw new Error('go-sdk go.mod: missing go directive')
  }
  return toolchain
}

export function parseNpmLatest(body: unknown, pkg: string): string {
  return requireString(asRecord(body, pkg).version, `${pkg} version`)
}

export function parsePypiLatest(body: unknown): string {
  const info = asRecord(asRecord(body, 'pypi mcp').info, 'pypi mcp.info')
  return requireString(info.version, 'pypi mcp version')
}

export function parseRubyGemsLatest(body: unknown): string {
  return requireString(asRecord(body, 'rubygems mcp').version, 'rubygems mcp version')
}

export function parseCratesLatest(body: unknown): string {
  const crate = asRecord(asRecord(body, 'crates.io rmcp').crate, 'crates.io rmcp.crate')
  return requireString(crate.max_stable_version, 'crates.io rmcp max_stable_version')
}

/** `setup-go` / synthetic `go.mod` pin — major.minor of `goToolchain`. */
export function goToolchainMinor(pin: string): string {
  const [major, minor] = pin.split('.')
  if (major === undefined || minor === undefined) {
    throw new Error(`goToolchain must be major.minor.patch, got ${pin}`)
  }
  return `${major}.${minor}`
}

function npmLatestUrl(pkg: string): string {
  return `https://registry.npmjs.org/${encodeURIComponent(pkg)}/latest`
}

function goLatestUrl(): string {
  return `https://proxy.golang.org/${GO_SDK_MODULE}/@latest`
}

function goModUrl(version: string): string {
  return `https://proxy.golang.org/${GO_SDK_MODULE}/@v/${version}.mod`
}

export async function fetchLatestMcpPins(load: FetchLike = fetch): Promise<McpPins> {
  const goSdk = parseGoLatest(await getJson(load, goLatestUrl()))
  const [goToolchain, npmCore, npmServer, npmNode, npmExtApps, pythonMcp, rubyMcp, rustRmcp] =
    await Promise.all([
      getOk(load, goModUrl(goSdk)).then(async res => parseGoToolchain(await res.text())),
      getJson(load, npmLatestUrl('@modelcontextprotocol/core')).then(body =>
        parseNpmLatest(body, '@modelcontextprotocol/core'),
      ),
      getJson(load, npmLatestUrl('@modelcontextprotocol/server')).then(body =>
        parseNpmLatest(body, '@modelcontextprotocol/server'),
      ),
      getJson(load, npmLatestUrl('@modelcontextprotocol/node')).then(body =>
        parseNpmLatest(body, '@modelcontextprotocol/node'),
      ),
      getJson(load, npmLatestUrl('@modelcontextprotocol/ext-apps')).then(body =>
        parseNpmLatest(body, '@modelcontextprotocol/ext-apps'),
      ),
      getJson(load, 'https://pypi.org/pypi/mcp/json').then(parsePypiLatest),
      getJson(load, 'https://rubygems.org/api/v1/gems/mcp.json').then(parseRubyGemsLatest),
      getJson(load, 'https://crates.io/api/v1/crates/rmcp').then(parseCratesLatest),
    ])

  return {
    goSdk,
    goToolchain,
    npmCore,
    npmServer,
    npmNode,
    npmExtApps,
    pythonMcp,
    rubyMcp,
    rustRmcp,
  }
}
