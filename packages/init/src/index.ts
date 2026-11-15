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
  readSolvaPayApiBaseUrlFromEnv,
  readSolvaPayProductRefFromEnv,
  readSolvaPaySecretKeyFromEnv,
  SOLVAPAY_PRODUCT_REF_PLACEHOLDER,
  writeSolvaPayApiBaseUrlToEnv,
  writeSolvaPayProductRefToEnv,
  writeSolvaPaySecretToEnv,
} from './env'
export type { EnvWriteResult, GitignoreEnvResult } from './env'

export {
  formatCommand,
  getInstallCommand,
  getSolvaPayBasePackages,
  goInstallCommands,
  installSolvaPaySdk,
  parseFeatures,
  pythonInstallCommands,
  pythonRequirement,
  runSdkCommand,
  SDK_FEATURES,
} from './install'
export type { InstallResult, SdkCommand, SdkFeature, TsInstallOptions } from './install'

export {
  detectProject,
  detectPythonManager,
  findLanguageMarkers,
  LANGUAGE_LABELS,
  LANGUAGES,
  parseLanguage,
} from './language'
export type { DetectedProject, DetectProjectOptions, Language, PythonManager } from './language'

export {
  compareGoVersions,
  comparePep440,
  fetchGoVersions,
  fetchPypiVersions,
  fetchSdkVersions,
  GO_MODULE,
  isSdkPreview,
  newestAny,
  newestStable,
  pickSdkVersion,
  PYPI_PACKAGE,
} from './sdk-registry'
export type { FetchVersions, SdkLanguage } from './sdk-registry'

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

export { isPreviewBuild } from './preview'
export { runInitInDirectory } from './run-init'
export type { InitCommandOptions, RunInitInDirectoryOptions } from './run-init'

export { runDoctorInDirectory } from './run-doctor'
export {
  compareStable,
  findOutdatedSolvapayPackages,
  installedGoSdk,
  installedPythonSdk,
  languageUpgradeCommand,
  solvapayDependencies,
  upgradeCommand,
} from './sdk-versions'
export type { DistTags, FetchDistTags, InstalledSdk, OutdatedPackage } from './sdk-versions'
export type {
  DoctorCheckResult,
  DoctorCommandOptions,
  DoctorReport,
  RunDoctorInDirectoryOptions,
} from './run-doctor'
