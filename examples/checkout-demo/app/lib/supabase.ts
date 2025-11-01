/**
 * Supabase Client Setup
 * 
 * Creates and exports the Supabase client for authentication.
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase environment variables not configured. Authentication will not work.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Get the current user's ID from Supabase session
 * Returns null if not authenticated
 */
export async function getUserId(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.id || null;
}

/**
 * Get the current user's access token for API calls
 * Returns null if not authenticated
 */
export async function getAccessToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token || null;
}

/**
 * Get the current user's email from Supabase session
 * Returns null if not authenticated
 */
export async function getUserEmail(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.email || null;
}

/**
 * Get the current user object from Supabase session
 * Returns null if not authenticated
 */
export async function getUser() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user || null;
}

/**
 * Sign up a new user with email and password
 */
export async function signUp(email: string, password: string) {
  return await supabase.auth.signUp({
    email,
    password,
  });
}

/**
 * Sign in an existing user with email and password
 */
export async function signIn(email: string, password: string) {
  return await supabase.auth.signInWithPassword({
    email,
    password,
  });
}

/**
 * Sign out the current user
 */
export async function signOut() {
  return await supabase.auth.signOut();
}

/**
 * Subscribe to auth state changes
 * Returns an unsubscribe function
 */
export function onAuthStateChange(callback: (event: string, session: any) => void) {
  return supabase.auth.onAuthStateChange(callback);
}

