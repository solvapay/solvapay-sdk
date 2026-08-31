import {
  createOnMessage as __wasmCreateOnMessageForFsProxy,
  getDefaultContext as __emnapiGetDefaultContext,
  instantiateNapiModuleSync as __emnapiInstantiateNapiModuleSync,
  WASI as __WASI,
} from '@napi-rs/wasm-runtime'



const __wasi = new __WASI({
  version: 'preview1',
})

const __wasmUrl = new URL('./server-native.wasm32-wasi.wasm', import.meta.url).href
const __emnapiContext = __emnapiGetDefaultContext()


const __sharedMemory = new WebAssembly.Memory({
  initial: 4000,
  maximum: 65536,
  shared: true,
})

const __wasmFile = await fetch(__wasmUrl).then((res) => res.arrayBuffer())

const {
  instance: __napiInstance,
  module: __wasiModule,
  napiModule: __napiModule,
} = __emnapiInstantiateNapiModuleSync(__wasmFile, {
  context: __emnapiContext,
  asyncWorkPoolSize: 4,
  wasi: __wasi,
  onCreateWorker() {
    const worker = new Worker(new URL('./wasi-worker-browser.mjs', import.meta.url), {
      type: 'module',
    })


    return worker
  },
  overwriteImports(importObject) {
    importObject.env = {
      ...importObject.env,
      ...importObject.napi,
      ...importObject.emnapi,
      memory: __sharedMemory,
    }
    return importObject
  },
  beforeInit({ instance }) {
    for (const name of Object.keys(instance.exports)) {
      if (name.startsWith('__napi_register__')) {
        instance.exports[name]()
      }
    }
  },
})
export default __napiModule.exports
export const NativeClient = __napiModule.exports.NativeClient
export const assertResponseResult = __napiModule.exports.assertResponseResult
export const assertValidProductRef = __napiModule.exports.assertValidProductRef
export const attachBusinessDetailsValidationError = __napiModule.exports.attachBusinessDetailsValidationError
export const billingCycle = __napiModule.exports.billingCycle
export const buildCreateCustomerParams = __napiModule.exports.buildCreateCustomerParams
export const buildGateMessage = __napiModule.exports.buildGateMessage
export const buildNudgeMessage = __napiModule.exports.buildNudgeMessage
export const buildPayableToolResult = __napiModule.exports.buildPayableToolResult
export const buildPaywallGate = __napiModule.exports.buildPaywallGate
export const buildPromptDescriptorMetadata = __napiModule.exports.buildPromptDescriptorMetadata
export const buildPromptUserMessage = __napiModule.exports.buildPromptUserMessage
export const buildToolDescriptorMetadata = __napiModule.exports.buildToolDescriptorMetadata
export const charges = __napiModule.exports.charges
export const classifyCancelError = __napiModule.exports.classifyCancelError
export const classifyCreateError = __napiModule.exports.classifyCreateError
export const classifyCustomerRef = __napiModule.exports.classifyCustomerRef
export const classifyLookupError = __napiModule.exports.classifyLookupError
export const classifyPaywallState = __napiModule.exports.classifyPaywallState
export const classifyReactivateError = __napiModule.exports.classifyReactivateError
export const coerceCustomerOptions = __napiModule.exports.coerceCustomerOptions
export const countsUsage = __napiModule.exports.countsUsage
export const creditsPerUnitFromBalance = __napiModule.exports.creditsPerUnitFromBalance
export const creditsToDisplayMinorUnits = __napiModule.exports.creditsToDisplayMinorUnits
export const decidePaywallOutcome = __napiModule.exports.decidePaywallOutcome
export const deriveIcons = __napiModule.exports.deriveIcons
export const deriveTaxIdType = __napiModule.exports.deriveTaxIdType
export const ensureCustomerNext = __napiModule.exports.ensureCustomerNext
export const evaluateBalanceObservation = __napiModule.exports.evaluateBalanceObservation
export const evaluateCachedLimits = __napiModule.exports.evaluateCachedLimits
export const evaluateFreshLimits = __napiModule.exports.evaluateFreshLimits
export const evaluateProductReadiness = __napiModule.exports.evaluateProductReadiness
export const extractBackendCustomerRef = __napiModule.exports.extractBackendCustomerRef
export const formatPrice = __napiModule.exports.formatPrice
export const formatSubtotalLabel = __napiModule.exports.formatSubtotalLabel
export const formatVatSummaryLabel = __napiModule.exports.formatVatSummaryLabel
export const gateNext = __napiModule.exports.gateNext
export const getBusinessCountryOptions = __napiModule.exports.getBusinessCountryOptions
export const getSellerTaxIdentifierDisplayLabel = __napiModule.exports.getSellerTaxIdentifierDisplayLabel
export const getTaxIdExample = __napiModule.exports.getTaxIdExample
export const getTaxIdFieldLabel = __napiModule.exports.getTaxIdFieldLabel
export const getTaxIdHelperText = __napiModule.exports.getTaxIdHelperText
export const headlineCharges = __napiModule.exports.headlineCharges
export const includedUnits = __napiModule.exports.includedUnits
export const invokePayableNext = __napiModule.exports.invokePayableNext
export const isCachedCustomerRefValid = __napiModule.exports.isCachedCustomerRefValid
export const isEmailConflict = __napiModule.exports.isEmailConflict
export const isErrorResult = __napiModule.exports.isErrorResult
export const isZeroDecimalCurrency = __napiModule.exports.isZeroDecimalCurrency
export const makeResponseResult = __napiModule.exports.makeResponseResult
export const mapRouteError = __napiModule.exports.mapRouteError
export const MCP_TOOL_NAMES = __napiModule.exports.MCP_TOOL_NAMES
export const mcpViewMaps = __napiModule.exports.mcpViewMaps
export const meterName = __napiModule.exports.meterName
export const minorUnitsPerMajor = __napiModule.exports.minorUnitsPerMajor
export const napiVersion = __napiModule.exports.napiVersion
export const normalizeCancelResponse = __napiModule.exports.normalizeCancelResponse
export const normalizeReactivateResponse = __napiModule.exports.normalizeReactivateResponse
export const paywallErrorToClientPayload = __napiModule.exports.paywallErrorToClientPayload
export const paywallToolResult = __napiModule.exports.paywallToolResult
export const peggedCreditsPerUnit = __napiModule.exports.peggedCreditsPerUnit
export const perUnitCharge = __napiModule.exports.perUnitCharge
export const projectPaymentIntentResult = __napiModule.exports.projectPaymentIntentResult
export const projectTopupProcessOutcome = __napiModule.exports.projectTopupProcessOutcome
export const projectUsageSnapshot = __napiModule.exports.projectUsageSnapshot
export const requireProductRef = __napiModule.exports.requireProductRef
export const resolveAuthenticatedUser = __napiModule.exports.resolveAuthenticatedUser
export const resolveCheckLimitsParams = __napiModule.exports.resolveCheckLimitsParams
export const resolveFallbackGateLimits = __napiModule.exports.resolveFallbackGateLimits
export const resolveProductRef = __napiModule.exports.resolveProductRef
export const resolvePurchaseCustomerRef = __napiModule.exports.resolvePurchaseCustomerRef
export const resolveReturnUrl = __napiModule.exports.resolveReturnUrl
export const resolveSellerIdentityDisplay = __napiModule.exports.resolveSellerIdentityDisplay
export const resolveTaxBehavior = __napiModule.exports.resolveTaxBehavior
export const resolveTaxTreatmentNote = __napiModule.exports.resolveTaxTreatmentNote
export const retryNextDelayMs = __napiModule.exports.retryNextDelayMs
export const REVERSE_CHARGE_NOTE = __napiModule.exports.REVERSE_CHARGE_NOTE
export const selectActivePurchases = __napiModule.exports.selectActivePurchases
export const SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE = __napiModule.exports.SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE
export const shouldRetryUsageError = __napiModule.exports.shouldRetryUsageError
export const shouldShowTaxRow = __napiModule.exports.shouldShowTaxRow
export const solvapayCall = __napiModule.exports.solvapayCall
export const TAX_NOT_COLLECTED_NOTE = __napiModule.exports.TAX_NOT_COLLECTED_NOTE
export const tierBands = __napiModule.exports.tierBands
export const tierMeters = __napiModule.exports.tierMeters
export const toMajorUnits = __napiModule.exports.toMajorUnits
export const trialDays = __napiModule.exports.trialDays
export const usageRate = __napiModule.exports.usageRate
export const validateActivatePlanParams = __napiModule.exports.validateActivatePlanParams
export const validateAttachBusinessDetailsParams = __napiModule.exports.validateAttachBusinessDetailsParams
export const validateBusinessDetails = __napiModule.exports.validateBusinessDetails
export const validateCheckoutSessionParams = __napiModule.exports.validateCheckoutSessionParams
export const validateCreatePaymentIntentParams = __napiModule.exports.validateCreatePaymentIntentParams
export const validateGetProductParams = __napiModule.exports.validateGetProductParams
export const validateListPlansParams = __napiModule.exports.validateListPlansParams
export const validateProcessPaymentIntentParams = __napiModule.exports.validateProcessPaymentIntentParams
export const validatePublicBaseUrl = __napiModule.exports.validatePublicBaseUrl
export const validatePurchaseRef = __napiModule.exports.validatePurchaseRef
export const validateTopupPaymentIntentParams = __napiModule.exports.validateTopupPaymentIntentParams
export const verifyWebhook = __napiModule.exports.verifyWebhook
