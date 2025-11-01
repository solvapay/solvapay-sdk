/**
 * Shared Demo API Client
 * 
 * This is the single source of truth for demo API client functionality.
 * All other files should import and use this instead of duplicating the class.
 */

export { createStubClient, StubSolvaPayClient } from '../../../shared/stub-api-client';

// Singleton instance with file storage enabled for this example
import { createStubClient } from '../../../shared/stub-api-client';

export const demoApiClient = createStubClient({ 
  useFileStorage: true, 
  debug: false 
});
