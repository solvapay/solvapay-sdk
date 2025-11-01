/**
 * Customer Management Utility
 * 
 * Handles customer ID persistence using localStorage for demo purposes.
 * In a production app, customer IDs would come from your authentication system.
 */

/**
 * Get or create a customer ID
 * Persists to localStorage for demo continuity across page refreshes
 */
export function getOrCreateCustomerId(): string {
  if (typeof window === 'undefined') return '';
  
  const STORAGE_KEY = 'solvapay_customer_id';
  
  let customerId = localStorage.getItem(STORAGE_KEY);
  
  if (!customerId) {
    // Generate a unique customer ID (use format that won't be changed by backend)
    customerId = `cus_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    localStorage.setItem(STORAGE_KEY, customerId);
  }
  
  return customerId;
}

/**
 * Update the stored customer ID
 * Used to replace the local customer ID with the backend customer reference
 */
export function updateCustomerId(newCustomerId: string): void {
  if (typeof window === 'undefined') return;
  const STORAGE_KEY = 'solvapay_customer_id';
  localStorage.setItem(STORAGE_KEY, newCustomerId);
}

/**
 * Clear customer ID (for testing purposes)
 */
export function clearCustomerId(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('solvapay_customer_id');
}

