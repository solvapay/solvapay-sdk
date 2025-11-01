/**
 * Test Logger Utility
 * 
 * Provides controlled logging for integration tests that can be enabled/disabled
 * via environment variable to reduce noise during test execution.
 * 
 * Usage:
 * ```typescript
 * import { testLog } from '@solvapay/test-utils';
 * 
 * testLog.info('✅ Test setup complete');
 * testLog.debug('🔍 Debug information:', { data });
 * testLog.warn('⚠️  Warning message');
 * testLog.error('❌ Error occurred');
 * 
 * // Always log (even when verbose is disabled)
 * testLog.always('📋 Important message');
 * ```
 * 
 * Environment Variables:
 * - `VERBOSE_TEST_LOGS=true` - Enable all test logging
 * - `VERBOSE_TEST_LOGS=false` or unset - Only show critical messages
 */

const isVerbose = process.env.VERBOSE_TEST_LOGS === 'true';

/**
 * Test logger with environment-based verbosity control
 */
export const testLog = {
  /**
   * Log informational messages (only when VERBOSE_TEST_LOGS=true)
   */
  info: (...args: any[]) => {
    if (isVerbose) {
      console.log(...args);
    }
  },

  /**
   * Log debug messages (only when VERBOSE_TEST_LOGS=true)
   */
  debug: (...args: any[]) => {
    if (isVerbose) {
      console.log(...args);
    }
  },

  /**
   * Log warning messages (only when VERBOSE_TEST_LOGS=true)
   */
  warn: (...args: any[]) => {
    if (isVerbose) {
      console.warn(...args);
    }
  },

  /**
   * Log error messages (only when VERBOSE_TEST_LOGS=true)
   */
  error: (...args: any[]) => {
    if (isVerbose) {
      console.error(...args);
    }
  },

  /**
   * Always log, regardless of VERBOSE_TEST_LOGS setting
   * Use for critical setup/teardown messages and test failures
   */
  always: (...args: any[]) => {
    console.log(...args);
  },

  /**
   * Check if verbose logging is enabled
   */
  isVerbose: () => isVerbose,
};

/**
 * Legacy compatibility: Direct function export
 * Logs only when VERBOSE_TEST_LOGS=true
 */
export const conditionalLog = (...args: any[]) => {
  if (isVerbose) {
    console.log(...args);
  }
};

/**
 * Always log, regardless of verbosity setting
 */
export const alwaysLog = (...args: any[]) => {
  console.log(...args);
};

