/**
 * Utility functions for the SolvaPay Server SDK
 */

/**
 * Retry configuration options
 */
export interface RetryOptions {
  /**
   * Maximum number of retry attempts (default: 2)
   */
  maxRetries?: number;
  
  /**
   * Initial delay between retries in milliseconds (default: 500)
   */
  initialDelay?: number;
  
  /**
   * Backoff strategy for calculating delay between retries (default: 'fixed')
   * - 'fixed': Same delay between all retries
   * - 'linear': Delay increases linearly (initialDelay * attempt)
   * - 'exponential': Delay doubles each attempt (initialDelay * 2^(attempt-1))
   */
  backoffStrategy?: 'fixed' | 'linear' | 'exponential';
  
  /**
   * Optional function to determine if a retry should be attempted based on the error
   * @param error The error that was thrown
   * @param attempt The current attempt number (0-indexed)
   * @returns true if a retry should be attempted, false otherwise
   */
  shouldRetry?: (error: Error, attempt: number) => boolean;
  
  /**
   * Optional callback invoked before each retry attempt
   * @param error The error that triggered the retry
   * @param attempt The current attempt number (0-indexed)
   */
  onRetry?: (error: Error, attempt: number) => void;
}

/**
 * Executes an async function with automatic retry logic
 * 
 * @template T The return type of the async function
 * @param fn The async function to execute
 * @param options Retry configuration options
 * @returns A promise that resolves with the function result or rejects with the last error
 * 
 * @example
 * ```typescript
 * // Simple retry with defaults
 * const result = await withRetry(() => apiCall());
 * 
 * // Custom retry with conditional logic
 * const result = await withRetry(
 *   () => apiCall(),
 *   {
 *     maxRetries: 3,
 *     initialDelay: 1000,
 *     backoffStrategy: 'exponential',
 *     shouldRetry: (error) => error.message.includes('timeout'),
 *     onRetry: (error, attempt) => console.log(`Retry ${attempt + 1}`)
 *   }
 * );
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 2,
    initialDelay = 500,
    backoffStrategy = 'fixed',
    shouldRetry,
    onRetry
  } = options;

  let lastError: Error;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      const isLastAttempt = attempt === maxRetries;
      
      // Check if we should retry
      if (isLastAttempt) {
        throw lastError;
      }
      
      // If shouldRetry is provided, use it to determine if we should retry
      if (shouldRetry && !shouldRetry(lastError, attempt)) {
        throw lastError;
      }
      
      // Calculate delay based on backoff strategy
      const delay = calculateDelay(initialDelay, attempt, backoffStrategy);
      
      // Call onRetry callback if provided
      if (onRetry) {
        onRetry(lastError, attempt);
      }
      
      // Wait before retrying
      await sleep(delay);
    }
  }
  
  // This should never be reached, but TypeScript needs it
  throw lastError!;
}

/**
 * Calculate the delay before the next retry based on the backoff strategy
 */
function calculateDelay(
  initialDelay: number,
  attempt: number,
  strategy: 'fixed' | 'linear' | 'exponential'
): number {
  switch (strategy) {
    case 'fixed':
      return initialDelay;
    case 'linear':
      return initialDelay * (attempt + 1);
    case 'exponential':
      return initialDelay * Math.pow(2, attempt);
    default:
      return initialDelay;
  }
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

