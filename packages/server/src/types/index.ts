/**
 * SolvaPay Server SDK - Type Definitions
 *
 * Shared types and interfaces for the SolvaPay server SDK.
 * These types are used across paywall protection and API client implementations.
 */

// Re-export generated types
export type { paths, components, operations } from './generated'

// Re-export client types from types/client.ts
export type {
  LimitResponseWithPlan,
  CustomerResponseMapped,
  UsageMeterType,
  CheckLimitsRequest,
  McpBootstrapRequest,
  McpBootstrapResponse,
  McpBootstrapFreePlanConfig,
  McpBootstrapPaidPlanInput,
  ToolPlanMappingInput,
} from './client'
// Re-export SolvaPayClient interface from types/client.ts
export type { SolvaPayClient } from './client'

// Re-export paywall types
export type {
  PaywallArgs,
  PaywallMetadata,
  PaywallStructuredContent,
  PaywallToolResult,
} from './paywall'

// Re-export configuration options
export type {
  RetryOptions,
  PayableOptions,
  HttpAdapterOptions,
  NextAdapterOptions,
  McpAdapterOptions,
} from './options'

// Re-export webhook types
export type { WebhookEvent, WebhookEventType } from './webhook'
