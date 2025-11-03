import { createTask, listTasks } from '@solvapay/demo-services';
import { createSolvaPay } from '@solvapay/server';

// Lazy initialization to avoid build-time errors when API key is not configured
// Only creates SolvaPay instance when route handlers execute at runtime
function getSolvaPay() {
  return createSolvaPay();
}

/**
 * List tasks with pagination - Protected with paywall
 */
export const GET = async (request: Request, context?: any) => {
  const solvaPay = getSolvaPay();
  const payable = solvaPay.payable({ agent: 'crud-basic' });
  return payable.next(listTasks)(request, context);
};

/**
 * Create a new task - Protected with paywall
 */
export const POST = async (request: Request, context?: any) => {
  const solvaPay = getSolvaPay();
  const payable = solvaPay.payable({ agent: 'crud-basic' });
  return payable.next(createTask)(request, context);
};

