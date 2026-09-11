export {
  isScaffoldLanguage,
  LANGUAGE_LABELS,
  LANGUAGE_MANIFESTS,
  parseScaffoldLanguage,
  PREVIEW_LANGUAGES,
  SCAFFOLD_LANGUAGES,
} from './ids'
export type { ScaffoldLanguage } from './ids'

export { detectProjectLanguage } from './detect'
export type { LanguageDetection } from './detect'

export {
  LANGUAGE_RUNTIME_DEPS,
  resolveLatestSolvapayVersions,
  resolveLatestVersions,
} from './versions'
export type { LanguageDep, ResolveLatestVersionsOptions } from './versions'

export { getLanguageInstallCommand, installSdk, sdkInstallPlan } from './install'
export type { SdkInstallPlan } from './install'

export { languageChoiceEntries, promptChoice, promptLanguage } from './prompt'
export type { ChoiceEntry } from './prompt'
