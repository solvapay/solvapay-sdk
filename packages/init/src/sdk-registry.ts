/**
 * Published versions of the Python and Go SDKs, and which one to pin.
 *
 * - Python: `solvapay` on PyPI. Previews are `<next>.dev<n>` (PEP 440).
 * - Go: `github.com/solvapay/solvapay-sdk/go` on the Go module proxy.
 *   Previews are `v<next>-dev.<n>` (semver pre-release).
 *
 * Without `--preview` the newest stable release is pinned; when there is
 * none, the run fails and names the newest preview, so nothing installs a
 * preview by surprise. With `--preview` the newest version of any kind is
 * pinned, the way npm's `preview` tag points at the latest snapshot.
 */

export const PYPI_PACKAGE = 'solvapay'
export const GO_MODULE = 'github.com/solvapay/solvapay-sdk/go'

const PYPI_URL = `https://pypi.org/pypi/${PYPI_PACKAGE}/json`
const GO_PROXY_LIST_URL = `https://proxy.golang.org/${GO_MODULE}/@v/list`

export type FetchVersions = () => Promise<string[]>

const fetchOk = async (url: string): Promise<Response> => {
  let response: Response
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  } catch (error) {
    throw new Error(
      `Could not reach ${url}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return response
}

/** Every `solvapay` version on PyPI that has at least one file not yanked. */
export const fetchPypiVersions: FetchVersions = async () => {
  const body = (await (await fetchOk(PYPI_URL)).json()) as {
    releases?: Record<string, Array<{ yanked?: boolean }>>
  }
  if (!body.releases) throw new Error(`${PYPI_URL} has no "releases" field`)
  return Object.entries(body.releases)
    .filter(([, files]) => files.some(file => !file.yanked))
    .map(([version]) => version)
}

/** Every tagged version of the Go module the proxy knows. */
export const fetchGoVersions: FetchVersions = async () => {
  const text = await (await fetchOk(GO_PROXY_LIST_URL)).text()
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
}

// --- PEP 440 (the subset the SDK publishes: X.Y.Z, aN/bN/rcN, .postN, .devN)

type Pep440 = { release: number[]; pre?: [number, number]; post?: number; dev?: number }

const PEP440_RE = /^v?(\d+(?:\.\d+)*)(?:(a|b|rc)(\d+))?(?:\.post(\d+))?(?:\.dev(\d+))?$/

export const parsePep440 = (version: string): Pep440 => {
  const match = PEP440_RE.exec(version.trim())
  if (!match) throw new Error(`Not a PEP 440 version this CLI understands: "${version}"`)
  const [, release, preKind, preNumber, post, dev] = match
  return {
    release: release.split('.').map(Number),
    ...(preKind ? { pre: [{ a: 0, b: 1, rc: 2 }[preKind] as number, Number(preNumber)] } : {}),
    ...(post !== undefined ? { post: Number(post) } : {}),
    ...(dev !== undefined ? { dev: Number(dev) } : {}),
  }
}

export const isPythonPreview = (version: string): boolean => {
  const parsed = parsePep440(version)
  return parsed.pre !== undefined || parsed.dev !== undefined
}

/** PEP 440 ordering: 1.0.dev1 < 1.0a1 < 1.0rc1 < 1.0 < 1.0.post1. */
export const comparePep440 = (a: string, b: string): number => {
  const pa = parsePep440(a)
  const pb = parsePep440(b)
  const length = Math.max(pa.release.length, pb.release.length)
  for (let i = 0; i < length; i++) {
    const x = pa.release[i] ?? 0
    const y = pb.release[i] ?? 0
    if (x !== y) return x < y ? -1 : 1
  }
  // A bare .devN sorts before every pre-release of the same release.
  const preKey = (p: Pep440): [number, number] =>
    p.pre ?? (p.dev !== undefined && p.post === undefined ? [-1, 0] : [3, 0])
  const [ka, na] = preKey(pa)
  const [kb, nb] = preKey(pb)
  if (ka !== kb) return ka < kb ? -1 : 1
  if (na !== nb) return na < nb ? -1 : 1
  const postA = pa.post ?? -1
  const postB = pb.post ?? -1
  if (postA !== postB) return postA < postB ? -1 : 1
  const devA = pa.dev ?? Number.POSITIVE_INFINITY
  const devB = pb.dev ?? Number.POSITIVE_INFINITY
  if (devA !== devB) return devA < devB ? -1 : 1
  return 0
}

// --- Semver, as Go module versions use it (v1.2.3, v1.2.3-dev.7)

type Semver = { core: [number, number, number]; pre: string[] }

const SEMVER_RE = /^v(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

export const parseGoVersion = (version: string): Semver => {
  const match = SEMVER_RE.exec(version.trim())
  if (!match) throw new Error(`Not a Go module version: "${version}"`)
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] ? match[4].split('.') : [],
  }
}

export const isGoPreview = (version: string): boolean => parseGoVersion(version).pre.length > 0

export const compareGoVersions = (a: string, b: string): number => {
  const pa = parseGoVersion(a)
  const pb = parseGoVersion(b)
  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] < pb.core[i] ? -1 : 1
  }
  if (pa.pre.length === 0 || pb.pre.length === 0) {
    if (pa.pre.length === pb.pre.length) return 0
    return pa.pre.length === 0 ? 1 : -1
  }
  const length = Math.max(pa.pre.length, pb.pre.length)
  for (let i = 0; i < length; i++) {
    const x = pa.pre[i]
    const y = pb.pre[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const xNum = /^\d+$/.test(x)
    const yNum = /^\d+$/.test(y)
    if (xNum && yNum) {
      if (Number(x) !== Number(y)) return Number(x) < Number(y) ? -1 : 1
    } else if (xNum !== yNum) {
      return xNum ? -1 : 1
    } else if (x !== y) {
      return x < y ? -1 : 1
    }
  }
  return 0
}

export type SdkLanguage = 'python' | 'go'

const RULES: Record<
  SdkLanguage,
  {
    name: string
    registry: string
    compare: (a: string, b: string) => number
    isPreview: (v: string) => boolean
  }
> = {
  python: {
    name: PYPI_PACKAGE,
    registry: 'PyPI',
    compare: comparePep440,
    isPreview: isPythonPreview,
  },
  go: {
    name: GO_MODULE,
    registry: 'the Go module proxy',
    compare: compareGoVersions,
    isPreview: isGoPreview,
  },
}

export const compareSdkVersions = (language: SdkLanguage, a: string, b: string): number =>
  RULES[language].compare(a, b)

export const isSdkPreview = (language: SdkLanguage, version: string): boolean =>
  RULES[language].isPreview(version)

const newest = (language: SdkLanguage, versions: string[]): string | undefined =>
  [...versions].sort(RULES[language].compare).at(-1)

/** The newest stable version, or `undefined` when only previews exist. */
export const newestStable = (language: SdkLanguage, versions: string[]): string | undefined =>
  newest(
    language,
    versions.filter(v => !RULES[language].isPreview(v)),
  )

/** The newest version of any kind. */
export const newestAny = (language: SdkLanguage, versions: string[]): string | undefined =>
  newest(language, versions)

/**
 * The version to pin: newest stable, or with `preview` the newest of any kind.
 * Throws when nothing fits, naming `--preview` if a preview would.
 */
export const pickSdkVersion = (
  language: SdkLanguage,
  versions: string[],
  { preview }: { preview: boolean },
): string => {
  const rule = RULES[language]
  const any = newestAny(language, versions)
  if (!any) throw new Error(`${rule.registry} lists no versions of ${rule.name}.`)
  if (preview) return any
  const stable = newestStable(language, versions)
  if (!stable) {
    throw new Error(
      `${rule.name} has no stable release on ${rule.registry} yet (newest preview: ${any}). ` +
        'Pass --preview to install the preview.',
    )
  }
  return stable
}

export const fetchSdkVersions = (language: SdkLanguage): Promise<string[]> =>
  language === 'python' ? fetchPypiVersions() : fetchGoVersions()
