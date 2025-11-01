import { createTask, listTasks } from '@solvapay/demo-services';
import { createSolvaPay } from '@solvapay/server';
import { demoApiClient } from '@/services/apiClient';

// Create a reusable SolvaPay instance with the new unified API
const solvaPay = createSolvaPay({
  apiClient: demoApiClient
});

// Create payable handler with explicit Next.js adapter
const payable = solvaPay.payable({ agent: 'crud-basic' });

/**
 * List tasks with pagination - Protected with paywall
 */
export const GET = payable.next(listTasks);

/**
 * Create a new task - Protected with paywall
 */
export const POST = payable.next(createTask);

