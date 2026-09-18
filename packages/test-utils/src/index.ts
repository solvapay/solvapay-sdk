/**
 * @solvapay/test-utils
 *
 * Shared test utilities for SDK testing.
 * This package is private and not published to npm.
 */

// Integration test setup utilities
export {
  buildTestPlanOptions,
  createTestPlan,
  createMultiCurrencyPaidTestPlan,
  createTestProduct,
  deleteTestPlan,
  deleteTestProduct,
  createTestProvider,
} from './integration-setup'

export type {
  TestProviderSetup,
  TestProductSetup,
  TestPlanSetup,
  TestPlanPricingOption,
} from './integration-setup'

// Stripe payment test helpers
export {
  createTestPaymentIntent,
  confirmPaymentWithTestCard,
  waitForWebhookProcessing,
  waitForPaymentIntentStatus,
  STRIPE_TEST_CARDS,
} from './stripe-test-helpers'

// Test logging utilities
export { testLog, conditionalLog, alwaysLog } from './test-logger'

// Adapter contract test helpers
export { describeAuthAdapterContract } from './describeAuthAdapterContract'
export { describeClientAuthAdapterContract } from './describeClientAuthAdapterContract'

export const TEST_UTILS_VERSION = '0.0.0'

// Vault capture mock (jsdom). Cross-origin iframes do not exist there, so the
// card fields cannot be rendered or typed into without a stand-in.
export { installMockVault, mockCaptureSession, MOCK_VAULT_FIELD_NAMES } from './mock-vault'
export type {
  MockVault,
  MockVaultOptions,
  MockVaultCard,
  MockVaultFailure,
  MockVaultFieldCall,
  MockVaultCreateCardCall,
} from './mock-vault'
