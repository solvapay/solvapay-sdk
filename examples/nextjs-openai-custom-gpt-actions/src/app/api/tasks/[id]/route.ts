import { getTask, deleteTask } from '@solvapay/demo-services';
import { createSolvaPay } from '@solvapay/server';

// Lazy initialization to avoid build-time errors when API key is not configured
// Only creates SolvaPay instance when route handlers execute at runtime
function getSolvaPay() {
  return createSolvaPay();
}

/**
 * Get a specific task by ID - Protected with paywall
 */
export const GET = async (request: Request, context?: any) => {
  const solvaPay = getSolvaPay();
  const basicPayable = solvaPay.payable({ agent: 'crud-basic' });
  return basicPayable.next(getTask)(request, context);
};

/**
 * Delete a specific task by ID - Protected with paywall (premium operation)
 */
export const DELETE = async (request: Request, context?: any) => {
  const solvaPay = getSolvaPay();
  const premiumPayable = solvaPay.payable({ agent: 'crud-premium' });
  return premiumPayable.next(deleteTask)(request, context);
};

