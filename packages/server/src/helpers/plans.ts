/**
 * Plans Helper (Core)
 * 
 * Generic helper for listing plans.
 * Works with standard Web API Request (works everywhere).
 * This is a public route - no authentication required.
 */

import type { ErrorResult } from './types';
import { createSolvaPayClient } from '../client';
import { handleRouteError } from './error';
import { getSolvaPayConfig } from '@solvapay/core';

/**
 * List plans - core implementation
 * 
 * @param request - Standard Web API Request
 * @returns Plans response or error result
 */
export async function listPlansCore(
  request: Request
): Promise<{
  plans: any[];
  agentRef: string;
} | ErrorResult> {
  try {
    const url = new URL(request.url);
    const agentRef = url.searchParams.get('agentRef');

    if (!agentRef) {
      return {
        error: 'Missing required parameter: agentRef',
        status: 400,
      };
    }

    // Get configuration from environment
    const config = getSolvaPayConfig();
    const solvapaySecretKey = config.apiKey;
    const solvapayApiBaseUrl = config.apiBaseUrl;

    if (!solvapaySecretKey) {
      return {
        error: 'Server configuration error: SolvaPay secret key not configured',
        status: 500,
      };
    }

    // Create SolvaPay API client
    const apiClient = createSolvaPayClient({
      apiKey: solvapaySecretKey,
      apiBaseUrl: solvapayApiBaseUrl,
    });

    if (!apiClient.listPlans) {
      return {
        error: 'List plans method not available',
        status: 500,
      };
    }

    const plans = await apiClient.listPlans(agentRef);

    // Return plans array
    return {
      plans: plans || [],
      agentRef,
    };
  } catch (error) {
    return handleRouteError(error, 'List plans', 'Failed to fetch plans');
  }
}

