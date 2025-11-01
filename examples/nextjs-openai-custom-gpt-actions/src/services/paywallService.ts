import { createSolvaPay } from '@solvapay/server';
import { demoApiClient } from './apiClient';

export class PaywallService {
  private solvaPay: any;

  constructor() {
    this.solvaPay = createSolvaPay({
      apiClient: demoApiClient
    });
  }

  async checkLimits(customerRef: string, agent: string, planRef?: string) {
    return demoApiClient.checkLimits({
      customerRef,
      agentRef: agent
    });
  }

  async trackUsage(customerRef: string, agent: string, outcome: 'success' | 'paywall' | 'fail' = 'success', action?: string) {
    return demoApiClient.trackUsage({
      customerRef,
      agentRef: agent,
      planRef: agent,
      outcome,
      action,
      requestId: `req_${Date.now()}`,
      actionDuration: 0,
      timestamp: new Date().toISOString()
    });
  }

  getCheckoutUrl(customerRef: string, agent: string) {
    return demoApiClient.getCheckoutUrl(customerRef, agent);
  }

  getSolvaPay() {
    return this.solvaPay;
  }
}

export const paywallService = new PaywallService();
