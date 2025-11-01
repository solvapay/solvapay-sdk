/**
 * Configuration Options Type Definitions
 * 
 * Types for configuring various aspects of the SDK including retry behavior,
 * payable protection, and framework adapters.
 */

/**
 * Retry configuration options
 */
export interface RetryOptions {
  /**
   * Maximum number of retry attempts (default: 2)
   */
  maxRetries?: number;
  
  /**
   * Initial delay between retries in milliseconds (default: 500)
   */
  initialDelay?: number;
  
  /**
   * Backoff strategy for calculating delay between retries (default: 'fixed')
   * - 'fixed': Same delay between all retries
   * - 'linear': Delay increases linearly (initialDelay * attempt)
   * - 'exponential': Delay doubles each attempt (initialDelay * 2^(attempt-1))
   */
  backoffStrategy?: 'fixed' | 'linear' | 'exponential';
  
  /**
   * Optional function to determine if a retry should be attempted based on the error
   * @param error The error that was thrown
   * @param attempt The current attempt number (0-indexed)
   * @returns true if a retry should be attempted, false otherwise
   */
  shouldRetry?: (error: Error, attempt: number) => boolean;
  
  /**
   * Optional callback invoked before each retry attempt
   * @param error The error that triggered the retry
   * @param attempt The current attempt number (0-indexed)
   */
  onRetry?: (error: Error, attempt: number) => void;
}

/**
 * Options for configuring payable protection
 */
export interface PayableOptions {
  /**
   * Agent identifier (auto-detected from package.json if not provided)
   */
  agent?: string;
  
  /**
   * Agent reference (alias for agent, preferred for consistency with backend API)
   */
  agentRef?: string;
  
  /**
   * Plan identifier (defaults to agent name if not provided)
   */
  plan?: string;
  
  /**
   * Plan reference (alias for plan, preferred for consistency with backend API)
   */
  planRef?: string;
  
  /**
   * Optional function to extract customer reference from context
   */
  getCustomerRef?: (context: any) => string | Promise<string>;
}

/**
 * HTTP adapter options for Express/Fastify
 */
export interface HttpAdapterOptions {
  /**
   * Extract arguments from HTTP request
   */
  extractArgs?: (req: any) => any;
  
  /**
   * Extract customer reference from HTTP request
   */
  getCustomerRef?: (req: any) => string | Promise<string>;
  
  /**
   * Transform the response before sending
   */
  transformResponse?: (result: any, reply: any) => any;
}

/**
 * Next.js adapter options for App Router
 */
export interface NextAdapterOptions {
  /**
   * Extract arguments from Web Request
   */
  extractArgs?: (request: Request, context?: any) => any | Promise<any>;
  
  /**
   * Extract customer reference from Web Request
   */
  getCustomerRef?: (request: Request) => string | Promise<string>;
  
  /**
   * Transform the response before returning
   */
  transformResponse?: (result: any) => any;
}

/**
 * MCP adapter options for MCP servers
 */
export interface McpAdapterOptions {
  /**
   * Extract customer reference from MCP args
   */
  getCustomerRef?: (args: any) => string | Promise<string>;
  
  /**
   * Transform the response before wrapping in MCP format
   */
  transformResponse?: (result: any) => any;
}

