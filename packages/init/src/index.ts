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
  VerifyProductRefResult,
} from './browser-auth'

export {
  ensureEnvInGitignore,
  readSolvaPayProductRefFromEnv,
  SOLVAPAY_PRODUCT_REF_PLACEHOLDER,
  writeSolvaPayApiBaseUrlToEnv,
  writeSolvaPayProductRefToEnv,
  writeSolvaPaySecretToEnv,
} from './env'
export type { EnvWriteResult, GitignoreEnvResult } from './env'

export {
  getInstallCommand,
  getSolvaPayBasePackages,
  installSolvaPaySdk,
} from './install'
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

export { runInitInDirectory } from './run-init'
export type { InitCommandOptions, RunInitInDirectoryOptions } from './run-init'
