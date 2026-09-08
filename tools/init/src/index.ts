export {
  createInitSession,
  openAuthUrl,
  verifyProductRef,
  verifySecretKey,
  waitForExchange,
} from './browser-auth'
export type {
  ExchangeResponse,
  InitSessionResponse,
  VerifiedProductSummary,
  VerifyProductRefResult,
} from './browser-auth'
export {
  ensureEnvInGitignore,
  isExampleSecretKey,
  readSolvaPayApiBaseUrlFromEnv,
  readSolvaPayProductRefFromEnv,
  readSolvaPaySecretKeyFromEnv,
  SOLVAPAY_PRODUCT_REF_PLACEHOLDER,
  writeSolvaPayApiBaseUrlToEnv,
  writeSolvaPayProductRefToEnv,
  writeSolvaPaySecretToEnv,
} from './env'
export type { EnvWriteResult, GitignoreEnvResult } from './env'

export { getInstallCommand, getSolvaPayBasePackages, installSolvaPaySdk } from './install'
export type { InstallResult } from './install'

export {
  askKeepConfiguredProduct,
  formatConfiguredProductLabel,
  pickProductInteractive,
} from './product-picker'
export type { PickResult } from './product-picker'

export { listProducts } from './products'
export type { ListProductsResult, ProductSummary } from './products'

export { detectPackageManager, ensureNodeProject, waitForEnter } from './project'
export type { EnsureNodeProjectResult, PackageManager } from './project'

export {
  detectProjectLanguage,
  getLanguageInstallCommand,
  installSdk,
  isScaffoldLanguage,
  LANGUAGE_LABELS,
  LANGUAGE_MANIFESTS,
  LANGUAGE_RUNTIME_DEPS,
  languageChoiceEntries,
  parseScaffoldLanguage,
  PREVIEW_LANGUAGES,
  promptChoice,
  promptLanguage,
  resolveLatestSolvapayVersions,
  resolveLatestVersions,
  SCAFFOLD_LANGUAGES,
  sdkInstallPlan,
} from './language'
export type {
  ChoiceEntry,
  LanguageDep,
  LanguageDetection,
  ResolveLatestVersionsOptions,
  ScaffoldLanguage,
  SdkInstallPlan,
} from './language'

export { DEFAULT_API_BASE_URL, DEV_API_BASE_URL, resolveCliApiBaseUrl } from './api-base'
export type { ApiBaseResolveOptions } from './api-base'

export { runInitInDirectory } from './run-init'
export type { InitCommandOptions, RunInitInDirectoryOptions } from './run-init'

export { runDoctorInDirectory } from './run-doctor'
export type {
  DoctorCheckResult,
  DoctorCommandOptions,
  DoctorReport,
  RunDoctorInDirectoryOptions,
} from './run-doctor'
