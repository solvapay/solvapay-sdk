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

// Vault checkout (VGS Collect) fake
export { createFakeCollect, VAULT_TEST_CARDS } from './fake-collect'
export type {
  FakeCollectCard,
  FakeCollectFieldState,
  FakeCollectForm,
  FakeCollectHandle,
  FakeCollectOptions,
} from './fake-collect'

export const TEST_UTILS_VERSION = '0.0.0'
