/**
 * Vault capture surface.
 *
 * Framework-neutral. The React bindings live in `../primitives/CardFields`.
 */

export {
  CaptureError,
  REQUIRED_CAPTURE_FIELDS,
  emptyCaptureState,
  emptyFieldState,
  isComplete,
  isReady,
  isSessionUsable,
  type CaptureEnvironment,
  type CaptureErrorCode,
  type CaptureFieldName,
  type CaptureFieldOptions,
  type CaptureFieldState,
  type CaptureFieldStyle,
  type CaptureSession,
  type CaptureState,
  type CapturedInstrument,
  type CardBrand,
  type InstrumentDescriptors,
} from './types'

export {
  assertIntegrityForLive,
  loadVaultScript,
  resetVaultScriptLoaderForTests,
  type VaultScriptConfig,
} from './loadVaultScript'

export {
  CaptureForm,
  normaliseVendorState,
  toCaptureError,
  toInstrument,
  type CaptureFormOptions,
  type MountFieldOptions,
} from './captureForm'
