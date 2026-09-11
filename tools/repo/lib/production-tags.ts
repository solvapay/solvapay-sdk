import {
  parseSemver,
  RELEASE_TRAIN_LANGUAGES,
  trainTags,
  type ReleaseTrainLanguage,
} from './release-channel.js'

const ENV_KEYS = {
  rust: 'RELEASE_PROD_RUST',
  python: 'RELEASE_PROD_PYTHON',
  ruby: 'RELEASE_PROD_RUBY',
  go: 'RELEASE_PROD_GO',
} as const satisfies Record<ReleaseTrainLanguage, string>

export function sentinelMoved(current: string, previous: string): boolean {
  return current !== previous
}

function envFlagOn(value: string | undefined): boolean {
  return value === 'true' || value === '1'
}

export function enabledProductionLanguages(
  env: Record<string, string | undefined>,
): ReleaseTrainLanguage[] {
  return RELEASE_TRAIN_LANGUAGES.filter(language => envFlagOn(env[ENV_KEYS[language]]))
}

export function productionTagsToPush(
  version: string,
  languages: readonly ReleaseTrainLanguage[],
): string[] {
  parseSemver(version)
  const tags = trainTags(version, 'production')
  return languages.map(language => tags[language])
}
