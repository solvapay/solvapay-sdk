import { z } from "zod";

export const Env = z.object({
  SOLVAPAY_SECRET_KEY: z.string().min(1),
  SOLVAPAY_API_BASE_URL: z.string().url().optional(),
});
export type Env = z.infer<typeof Env>;

/**
 * Base error class for SolvaPay SDK errors.
 * 
 * All SolvaPay SDK errors extend this class, making it easy to catch
 * and handle SDK-specific errors separately from other errors.
 * 
 * @example
 * ```typescript
 * import { SolvaPayError } from '@solvapay/core';
 * 
 * try {
 *   const config = getSolvaPayConfig();
 * } catch (error) {
 *   if (error instanceof SolvaPayError) {
 *     // Handle SolvaPay-specific error
 *     console.error('SolvaPay error:', error.message);
 *   } else {
 *     // Handle other errors
 *     throw error;
 *   }
 * }
 * ```
 * 
 * @since 1.0.0
 */
export class SolvaPayError extends Error {
  /**
   * Creates a new SolvaPayError instance.
   * 
   * @param message - Error message
   */
  constructor(message: string) {
    super(message);
    this.name = "SolvaPayError";
  }
}

export interface SolvaPayConfig {
  apiKey: string;
  apiBaseUrl?: string;
}

/**
 * Validates and returns SolvaPay configuration from environment variables.
 * 
 * Reads `SOLVAPAY_SECRET_KEY` and optional `SOLVAPAY_API_BASE_URL` from
 * environment variables and returns a validated configuration object.
 * 
 * @returns SolvaPayConfig object with apiKey and optional apiBaseUrl
 * @throws {SolvaPayError} If SOLVAPAY_SECRET_KEY is missing
 * 
 * @example
 * ```typescript
 * import { getSolvaPayConfig } from '@solvapay/core';
 * 
 * try {
 *   const config = getSolvaPayConfig();
 *   console.log('API Key configured:', config.apiKey);
 * } catch (error) {
 *   console.error('Configuration error:', error.message);
 * }
 * ```
 * 
 * @see {@link SolvaPayConfig} for the return type
 * @see {@link SolvaPayError} for error handling
 * @since 1.0.0
 */
export function getSolvaPayConfig(): SolvaPayConfig {
  const solvapaySecretKey = process.env.SOLVAPAY_SECRET_KEY;
  const solvapayApiBaseUrl = process.env.SOLVAPAY_API_BASE_URL;

  if (!solvapaySecretKey) {
    throw new SolvaPayError('Server configuration error: SolvaPay secret key not configured. Missing SOLVAPAY_SECRET_KEY environment variable.');
  }

  return {
    apiKey: solvapaySecretKey,
    apiBaseUrl: solvapayApiBaseUrl,
  };
}

export const version = "0.1.0";
