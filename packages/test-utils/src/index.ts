/**
 * @solvapay/test-utils
 * 
 * Shared test utilities for SDK testing.
 * This package is private and not published to npm.
 */

// Integration test setup utilities
export {
  createTestAgent,
  createTestPlan,
  deleteTestAgent,
  deleteTestPlan,
  createTestProvider
} from './integration-setup';

export type {
  TestProviderSetup,
  TestAgentSetup,
  TestPlanSetup
} from './integration-setup';

// Stripe payment test helpers
export {
  createTestPaymentIntent,
  confirmPaymentWithTestCard,
  waitForWebhookProcessing,
  waitForPaymentIntentStatus,
  STRIPE_TEST_CARDS
} from './stripe-test-helpers';

// Test logging utilities
export {
  testLog,
  conditionalLog,
  alwaysLog
} from './test-logger';

export const TEST_UTILS_VERSION = '0.0.0';
