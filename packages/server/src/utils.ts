/**
 * Utility functions for the SolvaPay Server SDK
 */

import type { RetryOptions } from './types';

/**
 * Execute an async function with automatic retry logic.
 * 
 * This utility function provides configurable retry logic with exponential backoff,
 * conditional retry logic, and retry callbacks. Useful for handling transient
 * network errors or rate limiting.
 * 
 * @template T The return type of the async function
 * @param fn The async function to execute
 * @param options Retry configuration options
 * @param options.maxRetries - Maximum number of retry attempts (default: 2)
 * @param options.initialDelay - Initial delay in milliseconds before first retry (default: 500)
 * @param options.backoffStrategy - Backoff strategy: 'fixed', 'linear', or 'exponential' (default: 'fixed')
 * @param options.shouldRetry - Optional function to determine if error should be retried
 * @param options.onRetry - Optional callback called before each retry attempt
 * @returns A promise that resolves with the function result or rejects with the last error
 * 
 * @example
 * ```typescript
 * // Simple retry with defaults (2 retries, 500ms delay)
 * const result = await withRetry(() => apiCall());
 * 
 * // Custom retry with exponential backoff
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
 * 
 * @since 1.0.0
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

/**
 * Request deduplication and caching options
 */
export interface RequestDeduplicationOptions {
  /**
   * Time-to-live for cached results in milliseconds (default: 2000)
   * Set to 0 to disable caching (only deduplicate concurrent requests)
   */
  cacheTTL?: number;
  
  /**
   * Maximum cache size before cleanup (default: 1000)
   * When exceeded, oldest entries are removed
   */
  maxCacheSize?: number;
  
  /**
   * Whether to cache error results (default: true)
   * When false, only successful results are cached
   */
  cacheErrors?: boolean;
}

/**
 * Cache entry for request deduplication
 */
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

/**
 * Request deduplication manager
 * 
 * Prevents duplicate API calls by:
 * 1. Deduplicating concurrent requests (multiple requests share the same promise)
 * 2. Caching results for a short time (prevents duplicate sequential requests)
 * 
 * Suitable for:
 * - Single-instance deployments (in-memory cache)
 * - Serverless functions (prevents duplicate invocations)
 * 
 * Note: For multi-instance deployments, consider using Redis or a shared cache
 * 
 * @example
 * ```typescript
 * const deduplicator = createRequestDeduplicator<ApiResponse>();
 * 
 * // All these calls will share the same promise and return the same result
 * const result1 = await deduplicator.deduplicate('user-123', () => fetchUserData('user-123'));
 * const result2 = await deduplicator.deduplicate('user-123', () => fetchUserData('user-123'));
 * const result3 = await deduplicator.deduplicate('user-123', () => fetchUserData('user-123'));
 * ```
 */
export function createRequestDeduplicator<T = unknown>(
  options: RequestDeduplicationOptions = {}
): {
  /**
   * Deduplicate a request by key
   * @param key Unique key for the request (e.g., userId)
   * @param fn Function to execute if not cached or in-flight
   * @returns Promise resolving to the result
   */
  deduplicate: (key: string, fn: () => Promise<T>) => Promise<T>;
  /**
   * Clear cache for a specific key
   */
  clearCache: (key: string) => void;
  /**
   * Clear all cache entries
   */
  clearAllCache: () => void;
  /**
   * Get cache statistics
   */
  getStats: () => { inFlight: number; cached: number };
} {
  const {
    cacheTTL = 2000,
    maxCacheSize = 1000,
    cacheErrors = true,
  } = options;

  const inFlightRequests = new Map<string, Promise<T>>();
  const resultCache = new Map<string, CacheEntry<T>>();
  let cleanupInterval: ReturnType<typeof setInterval> | null = null;

  // Start cleanup interval if caching is enabled
  if (cacheTTL > 0) {
    cleanupInterval = setInterval(() => {
      const now = Date.now();
      const entriesToDelete: string[] = [];

      for (const [key, cached] of resultCache.entries()) {
        if (now - cached.timestamp >= cacheTTL) {
          entriesToDelete.push(key);
        }
      }

      for (const key of entriesToDelete) {
        resultCache.delete(key);
      }

      // Enforce max cache size (remove oldest entries if exceeded)
      if (resultCache.size > maxCacheSize) {
        const sortedEntries = Array.from(resultCache.entries())
          .sort((a, b) => a[1].timestamp - b[1].timestamp);
        
        const toRemove = sortedEntries.slice(0, resultCache.size - maxCacheSize);
        for (const [key] of toRemove) {
          resultCache.delete(key);
        }
      }
    }, Math.min(cacheTTL, 1000)); // Clean up at least every second or every cacheTTL, whichever is smaller
  }

  const deduplicate = async (key: string, fn: () => Promise<T>): Promise<T> => {
    // Check cache first if caching is enabled
    if (cacheTTL > 0) {
      const cached = resultCache.get(key);
      if (cached && Date.now() - cached.timestamp < cacheTTL) {
        // Cache hit - return immediately without executing callback
        return cached.data;
      } else if (cached) {
        // Cache expired - remove it
        resultCache.delete(key);
      }
    }

    // Check if request is already in-flight
    let requestPromise = inFlightRequests.get(key);

    if (!requestPromise) {
      // Create new promise
      requestPromise = (async () => {
        try {
          const result = await fn();
          
          // Cache successful results
          if (cacheTTL > 0) {
            resultCache.set(key, {
              data: result,
              timestamp: Date.now(),
            });
          }
          
          return result;
        } catch (error) {
          // Cache error results if enabled
          if (cacheTTL > 0 && cacheErrors) {
            resultCache.set(key, {
              data: error as T,
              timestamp: Date.now(),
            });
          }
          
          throw error;
        } finally {
          // Clean up in-flight request
          inFlightRequests.delete(key);
        }
      })();

      // Store promise atomically (double-check locking pattern)
      const existingPromise = inFlightRequests.get(key);
      if (existingPromise) {
        requestPromise = existingPromise;
      } else {
        inFlightRequests.set(key, requestPromise);
      }
    }

    return requestPromise;
  };

  const clearCache = (key: string): void => {
    resultCache.delete(key);
  };

  const clearAllCache = (): void => {
    resultCache.clear();
  };

  const getStats = () => ({
    inFlight: inFlightRequests.size,
    cached: resultCache.size,
  });

  return {
    deduplicate,
    clearCache,
    clearAllCache,
    getStats,
  };
}

