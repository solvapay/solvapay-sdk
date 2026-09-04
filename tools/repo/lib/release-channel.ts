/**
 * Release channel + lockstep tag/version mapping.
 *
 * Channel is derived from the git ref only. Rehearsal refs live under
 * `rehearsal/` and can never match a production tag glob.
 */

export const RELEASE_TRAIN_LANGUAGES = ['rust', 'python', 'ruby', 'go'] as const

export type ReleaseTrainLanguage = (typeof RELEASE_TRAIN_LANGUAGES)[number]

export type ReleaseChannel = 'production' | 'rehearsal'

export type ReleaseEcosystem = 'npm' | 'cargo' | 'python' | 'ruby' | 'go'

export type RegistryTarget = {
  channel: ReleaseChannel
  ecosystem: ReleaseEcosystem
  host: string
}

const PRODUCTION_HOSTS: Record<ReleaseEcosystem, string> = {
  npm: 'https://registry.npmjs.org/',
  cargo: 'https://crates.io/',
  python: 'https://upload.pypi.org/legacy/',
  ruby: 'https://rubygems.org/',
  go: 'https://github.com/solvapay/solvapay-go',
}

const REHEARSAL_HOSTS: Record<ReleaseEcosystem, string> = {
  npm: 'http://127.0.0.1:4873/',
  cargo: 'http://127.0.0.1:8000/index/',
  python: 'https://test.pypi.org/legacy/',
  ruby: 'https://rubygems.pkg.github.com/solvapay',
  go: 'https://github.com/solvapay/solvapay-go-rehearsal',
}

const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

export function parseSemver(version: string): string {
  if (!SEMVER_RE.test(version)) {
    throw new Error(`release-channel: invalid lockstep semver: ${version}`)
  }
  return version
}

export function resolveChannelFromRef(ref: string): ReleaseChannel {
  const name = refName(ref)
  if (name.startsWith('rehearsal/')) return 'rehearsal'
  return 'production'
}

export function refName(ref: string): string {
  if (ref.startsWith('refs/tags/')) return ref.slice('refs/tags/'.length)
  if (ref.startsWith('refs/heads/')) return ref.slice('refs/heads/'.length)
  return ref
}

export function trainTagName(
  language: ReleaseTrainLanguage,
  version: string,
  channel: ReleaseChannel,
): string {
  const base = `solvapay-${language}-v${parseSemver(version)}`
  return channel === 'rehearsal' ? `rehearsal/${base}` : base
}

export function trainTags(
  version: string,
  channel: ReleaseChannel,
): Record<ReleaseTrainLanguage, string> {
  parseSemver(version)
  return {
    rust: trainTagName('rust', version, channel),
    python: trainTagName('python', version, channel),
    ruby: trainTagName('ruby', version, channel),
    go: trainTagName('go', version, channel),
  }
}

export type ParsedReleaseTag = {
  channel: ReleaseChannel
  language: ReleaseTrainLanguage
  version: string
}

export function parseReleaseTag(ref: string): ParsedReleaseTag {
  const channel = resolveChannelFromRef(ref)
  let name = refName(ref)
  if (name.startsWith('rehearsal/')) name = name.slice('rehearsal/'.length)
  for (const language of RELEASE_TRAIN_LANGUAGES) {
    const prefix = `solvapay-${language}-v`
    if (name.startsWith(prefix)) {
      return { channel, language, version: parseSemver(name.slice(prefix.length)) }
    }
  }
  throw new Error(`release-channel: not a release-train tag: ${ref}`)
}

export function ecosystemVersion(
  baseVersion: string,
  channel: ReleaseChannel,
  ecosystem: ReleaseEcosystem,
  runNumber: number,
): string {
  const base = parseSemver(baseVersion)
  if (channel === 'production') return base
  if (!Number.isInteger(runNumber) || runNumber < 1) {
    throw new Error(
      `release-channel: rehearsal run number must be a positive integer, got ${runNumber}`,
    )
  }
  switch (ecosystem) {
    case 'npm':
    case 'cargo':
    case 'go':
      return `${base}-rehearsal.${runNumber}`
    case 'python':
      return `${base}.dev${runNumber}`
    case 'ruby':
      return `${base}.pre.${runNumber}`
  }
}

export function registryHost(channel: ReleaseChannel, ecosystem: ReleaseEcosystem): string {
  return channel === 'production' ? PRODUCTION_HOSTS[ecosystem] : REHEARSAL_HOSTS[ecosystem]
}

export function registryTarget(
  channel: ReleaseChannel,
  ecosystem: ReleaseEcosystem,
): RegistryTarget {
  return { channel, ecosystem, host: registryHost(channel, ecosystem) }
}

export function assertHostMatchesChannel(
  channel: ReleaseChannel,
  ecosystem: ReleaseEcosystem,
  host: string,
): void {
  const expected = registryHost(channel, ecosystem)
  if (normalizeHost(host) !== normalizeHost(expected)) {
    throw new Error(
      `release-channel: host ${host} does not match ${channel} ${ecosystem} (expected ${expected})`,
    )
  }
}

function normalizeHost(host: string): string {
  return host.replace(/\/+$/, '')
}

export function tagsAlreadyOnRemote(
  tags: readonly string[],
  remoteTagNames: readonly string[],
): string[] {
  const remote = new Set(remoteTagNames)
  return tags.filter(tag => remote.has(tag))
}

export function assertTagsAvailable(
  tags: readonly string[],
  remoteTagNames: readonly string[],
): void {
  const existing = tagsAlreadyOnRemote(tags, remoteTagNames)
  if (existing.length > 0) {
    throw new Error(`release-channel: tags already exist on remote: ${existing.join(', ')}`)
  }
}

export function assertAllRehearsalTags(tags: readonly string[]): void {
  const invalid = tags.filter(tag => !tag.startsWith('rehearsal/'))
  if (invalid.length > 0) {
    throw new Error(
      `release-channel: refusing to operate on non-rehearsal tags: ${invalid.join(', ')}`,
    )
  }
}
