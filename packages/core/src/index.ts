import { z } from "zod";

export const Env = z.object({
  SOLVAPAY_SECRET_KEY: z.string().min(1),
  SOLVAPAY_API_BASE_URL: z.string().url().optional(),
});
export type Env = z.infer<typeof Env>;

export class SolvaPayError extends Error {
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
 * Throws SolvaPayError if required environment variables are missing.
 * 
 * @returns SolvaPayConfig object with apiKey and optional apiBaseUrl
 * @throws SolvaPayError if SOLVAPAY_SECRET_KEY is missing
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
