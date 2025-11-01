import { getTask, deleteTask } from '@solvapay/demo-services';
import { createSolvaPay } from '@solvapay/server';
import { demoApiClient } from '@/services/apiClient';

// Create a reusable SolvaPay instance with the new unified API
const solvaPay = createSolvaPay({
  apiClient: demoApiClient
});

// Create payable handlers with different plans
const basicPayable = solvaPay.payable({ agent: 'crud-basic' });
const premiumPayable = solvaPay.payable({ agent: 'crud-premium' });

/**
 * Get a specific task by ID - Protected with paywall
 */
export const GET = basicPayable.next(getTask);

/**
 * Delete a specific task by ID - Protected with paywall (premium operation)
 */
export const DELETE = premiumPayable.next(deleteTask);

