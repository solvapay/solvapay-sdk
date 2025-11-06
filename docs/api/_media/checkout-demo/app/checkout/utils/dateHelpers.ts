/**
 * Format a date string to a readable format
 */
export function formatDate(dateString?: string): string | null {
  if (!dateString) return null;
  return new Date(dateString).toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
}

/**
 * Calculate days until a given date
 */
export function getDaysUntilExpiration(endDate?: string): number | null {
  if (!endDate) return null;
  const now = new Date();
  const expiration = new Date(endDate);
  const diffTime = expiration.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays > 0 ? diffDays : 0;
}

