/**
 * Storage adapter for user plans
 * 
 * This adapter handles persistent storage of user plans across serverless environments.
 * It supports both Vercel KV (for production) and file-based storage (for local dev).
 */

import { kv } from '@vercel/kv';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';

// Create Redis client for direct Redis connection
let redisClient: any = null;

export interface UserPlan {
  plan: string;
  upgradedAt: string;
}

export type UserPlans = Record<string, UserPlan>;

export interface Thing {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export type Things = Record<string, Thing>;

const USER_PLANS_KEY = 'user-plans';
const THINGS_KEY = 'things';
const LOCAL_FILE_PATH = join(process.cwd(), 'user-plans.json');
const THINGS_FILE_PATH = join(process.cwd(), 'things.json');

/**
 * Determine if we're running on Vercel (production/preview)
 */
function isVercelEnvironment(): boolean {
  return !!process.env.VERCEL || !!process.env.REDIS_URL || !!process.env.KV_REST_API_URL;
}

/**
 * Check if Vercel KV/Redis is properly configured
 */
function isVercelKVConfigured(): boolean {
  const hasRedisUrl = !!process.env.REDIS_URL;
  const hasKvConfig = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
  
  console.log('🔍 [STORAGE] Environment check:', {
    VERCEL: !!process.env.VERCEL,
    REDIS_URL: !!process.env.REDIS_URL,
    KV_REST_API_URL: !!process.env.KV_REST_API_URL,
    KV_REST_API_TOKEN: !!process.env.KV_REST_API_TOKEN,
    hasRedisUrl,
    hasKvConfig,
    configured: hasRedisUrl || hasKvConfig
  });
  
  return hasRedisUrl || hasKvConfig;
}

/**
 * Get the appropriate storage client
 */
async function getStorageClient() {
  if (process.env.REDIS_URL) {
    // Use direct Redis connection for Vercel Redis
    if (!redisClient) {
      const { createClient } = await import('redis');
      redisClient = createClient({ url: process.env.REDIS_URL });
      await redisClient.connect();
    }
    return redisClient;
  } else if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    // Use Vercel KV client
    return kv;
  }
  throw new Error('No Redis/KV configuration found');
}

/**
 * Load user plans from persistent storage
 */
export async function loadUserPlans(): Promise<UserPlans> {
  try {
    if (isVercelEnvironment() && isVercelKVConfigured()) {
      // Use Redis/KV in production
      const client = await getStorageClient();
      const plans = await client.get(USER_PLANS_KEY);
      const parsedPlans = plans ? JSON.parse(plans) : {};
      console.log('📦 [KV] Loaded user plans:', parsedPlans);
      return parsedPlans;
    } else if (isVercelEnvironment() && !isVercelKVConfigured()) {
      // Vercel environment but KV not configured - fallback to empty
      console.warn('⚠️ [STORAGE] Vercel KV not configured, returning empty plans');
      return {};
    } else {
      // Use file system for local development
      if (!existsSync(LOCAL_FILE_PATH)) {
        console.log('📁 [FILE] No user plans file found, returning empty');
        return {};
      }
      const content = readFileSync(LOCAL_FILE_PATH, 'utf-8');
      const plans = JSON.parse(content);
      console.log('📁 [FILE] Loaded user plans:', plans);
      return plans;
    }
  } catch (error) {
    console.error('❌ [STORAGE] Failed to load user plans:', error);
    return {};
  }
}

/**
 * Save user plans to persistent storage
 */
export async function saveUserPlans(plans: UserPlans): Promise<void> {
  console.log('🔍 [STORAGE] saveUserPlans called with:', plans);
  
  try {
    if (isVercelEnvironment() && isVercelKVConfigured()) {
      // Use Redis/KV in production
      console.log('🔍 [STORAGE] Using Redis/KV for storage');
      const client = await getStorageClient();
      console.log('🔍 [STORAGE] Got storage client, saving to Redis...');
      await client.set(USER_PLANS_KEY, JSON.stringify(plans));
      console.log('✅ [STORAGE] Successfully saved user plans to Redis:', plans);
    } else if (isVercelEnvironment() && !isVercelKVConfigured()) {
      // Vercel environment but KV not configured - log warning
      console.warn('⚠️ [STORAGE] Vercel KV not configured, cannot save plans');
      throw new Error('Vercel KV not configured. Please set up REDIS_URL or KV_REST_API_URL and KV_REST_API_TOKEN environment variables.');
    } else {
      // Use file system for local development
      console.log('🔍 [STORAGE] Using file system for storage');
      writeFileSync(LOCAL_FILE_PATH, JSON.stringify(plans, null, 2));
      console.log('✅ [STORAGE] Successfully saved user plans to file:', plans);
    }
  } catch (error) {
    console.error('❌ [STORAGE] Failed to save user plans:', error);
    throw error;
  }
}

/**
 * Update a single user's plan
 */
export async function updateUserPlan(userId: string, plan: string): Promise<UserPlan> {
  console.log(`🔍 [STORAGE] updateUserPlan called with:`, { userId, plan });
  
  const plans = await loadUserPlans();
  console.log(`🔍 [STORAGE] Current plans before update:`, plans);
  
  const updatedPlan: UserPlan = {
    plan: plan || 'pro',
    upgradedAt: new Date().toISOString()
  };
  
  plans[userId] = updatedPlan;
  console.log(`🔍 [STORAGE] Plans after update:`, plans);
  
  await saveUserPlans(plans);
  
  console.log(`✅ [STORAGE] Updated plan for user ${userId}:`, updatedPlan);
  return updatedPlan;
}

/**
 * Get a specific user's plan
 */
export async function getUserPlan(userId: string): Promise<UserPlan | null> {
  const plans = await loadUserPlans();
  return plans[userId] || null;
}

/**
 * Get all user plans (for debugging)
 */
export async function getAllUserPlans(): Promise<UserPlans> {
  return loadUserPlans();
}

/**
 * Load things from persistent storage
 */
export async function loadThings(): Promise<Things> {
  try {
    if (isVercelEnvironment() && isVercelKVConfigured()) {
      // Use Redis/KV in production
      const client = await getStorageClient();
      const things = await client.get(THINGS_KEY);
      const parsedThings = things ? JSON.parse(things) : {};
      console.log('📦 [KV] Loaded things:', parsedThings);
      return parsedThings;
    } else if (isVercelEnvironment() && !isVercelKVConfigured()) {
      // Vercel environment but KV not configured - fallback to empty
      console.warn('⚠️ [STORAGE] Vercel KV not configured, returning empty things');
      return {};
    } else {
      // Use file system for local development
      if (!existsSync(THINGS_FILE_PATH)) {
        console.log('📁 [FILE] No things file found, returning empty');
        return {};
      }
      const content = readFileSync(THINGS_FILE_PATH, 'utf-8');
      const things = JSON.parse(content);
      console.log('📁 [FILE] Loaded things:', things);
      return things;
    }
  } catch (error) {
    console.error('❌ [STORAGE] Failed to load things:', error);
    return {};
  }
}

/**
 * Save things to persistent storage
 */
export async function saveThings(things: Things): Promise<void> {
  try {
    if (isVercelEnvironment() && isVercelKVConfigured()) {
      // Use Redis/KV in production
      const client = await getStorageClient();
      await client.set(THINGS_KEY, JSON.stringify(things));
      console.log('📦 [KV] Saved things:', things);
    } else if (isVercelEnvironment() && !isVercelKVConfigured()) {
      // Vercel environment but KV not configured - log warning
      console.warn('⚠️ [STORAGE] Vercel KV not configured, cannot save things');
      throw new Error('Vercel KV not configured. Please set up REDIS_URL or KV_REST_API_URL and KV_REST_API_TOKEN environment variables.');
    } else {
      // Use file system for local development
      writeFileSync(THINGS_FILE_PATH, JSON.stringify(things, null, 2));
      console.log('📁 [FILE] Saved things:', things);
    }
  } catch (error) {
    console.error('❌ [STORAGE] Failed to save things:', error);
    throw error;
  }
}

/**
 * Get all things (for debugging)
 */
export async function getAllThings(): Promise<Things> {
  return loadThings();
}
