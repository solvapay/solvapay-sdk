/**
 * User Plan Service
 * 
 * This service provides functions for managing user subscription plans.
 * It uses the storage adapter which automatically handles Vercel KV
 * in production and file-based storage in local development.
 */

import {
  loadUserPlans,
  saveUserPlans,
  updateUserPlan as updateUserPlanStorage,
  getUserPlan as getUserPlanStorage,
  getAllUserPlans,
  type UserPlan,
  type UserPlans
} from '@/lib/storage-adapter';

// Re-export types
export type { UserPlan, UserPlans };

// Re-export storage functions
export { loadUserPlans, saveUserPlans, getAllUserPlans };

/**
 * Update a user's plan
 */
export async function updateUserPlan(userId: string, plan: string): Promise<UserPlan> {
  return updateUserPlanStorage(userId, plan);
}

/**
 * Get a user's current plan
 */
export async function getUserPlan(userId: string): Promise<UserPlan | null> {
  return getUserPlanStorage(userId);
}
