export interface Task {
    id: string;
    title: string;
    description?: string;
    completed: boolean;
    createdAt: string;
    updatedAt: string;
  }
  
  // Re-export SDK types for convenience
  export type {
    PaywallArgs,
    PaywallMetadata,
    PaywallToolResult,
    SolvaPayClient
  } from '@solvapay/server';
  