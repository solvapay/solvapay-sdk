import { describe, it, expect } from 'vitest';
import {
  isPaidSubscription,
  filterSubscriptions,
  getPrimarySubscription,
  getActiveSubscriptions,
  getCancelledSubscriptionsWithEndDate,
} from '../subscriptions';
import type { SubscriptionInfo } from '../../types';

const createSubscription = (overrides: Partial<SubscriptionInfo> = {}): SubscriptionInfo => ({
  reference: 'sub_123',
  planName: 'Test Plan',
  agentName: 'Test Agent',
  status: 'active',
  startDate: '2024-01-01T00:00:00Z',
  amount: 1000,
  ...overrides,
});

describe('filterSubscriptions', () => {
  it('should filter to only include active subscriptions', () => {
    const subscriptions = [
      createSubscription({ status: 'active', planName: 'Active Plan' }),
      createSubscription({ status: 'cancelled', planName: 'Cancelled Plan' }),
      createSubscription({ status: 'expired', planName: 'Expired Plan' }),
      createSubscription({ status: 'active', planName: 'Another Active' }),
    ];
    
    const filtered = filterSubscriptions(subscriptions);
    
    expect(filtered).toHaveLength(2);
    expect(filtered.every(sub => sub.status === 'active')).toBe(true);
    expect(filtered.some(sub => sub.planName === 'Active Plan')).toBe(true);
    expect(filtered.some(sub => sub.planName === 'Another Active')).toBe(true);
  });

  it('should include cancelled subscriptions with status active', () => {
    const subscriptions = [
      createSubscription({
        status: 'active',
        planName: 'Cancelled but Active',
        cancelledAt: '2024-06-01T00:00:00Z',
      }),
    ];
    
    const filtered = filterSubscriptions(subscriptions);
    
    expect(filtered).toHaveLength(1);
    expect(filtered[0].status).toBe('active');
  });
});

describe('getActiveSubscriptions', () => {
  it('should return only subscriptions with status active', () => {
    const subscriptions = [
      createSubscription({ status: 'active', planName: 'Active 1' }),
      createSubscription({ status: 'active', planName: 'Active 2' }),
      createSubscription({ status: 'cancelled', planName: 'Cancelled' }),
    ];
    
    const active = getActiveSubscriptions(subscriptions);
    
    expect(active).toHaveLength(2);
    expect(active.every(sub => sub.status === 'active')).toBe(true);
  });
});

describe('getCancelledSubscriptionsWithEndDate', () => {
  it('should return cancelled subscriptions with status active and future endDate', () => {
    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 1);
    
    const subscriptions = [
      createSubscription({
        status: 'active',
        cancelledAt: '2024-06-01T00:00:00Z',
        endDate: futureDate.toISOString(),
        planName: 'Cancelled Active',
      }),
      createSubscription({
        status: 'active',
        cancelledAt: undefined,
        planName: 'Not Cancelled',
      }),
      createSubscription({
        status: 'active',
        cancelledAt: '2024-06-01T00:00:00Z',
        endDate: '2024-01-01T00:00:00Z', // Past date
        planName: 'Expired Cancelled',
      }),
    ];
    
    const cancelled = getCancelledSubscriptionsWithEndDate(subscriptions);
    
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0].planName).toBe('Cancelled Active');
  });
});

describe('isPaidSubscription', () => {
  it('should return true for subscription with amount > 0', () => {
    const sub = createSubscription({ amount: 1000 });
    expect(isPaidSubscription(sub)).toBe(true);
  });

  it('should return false for subscription with amount === 0', () => {
    const sub = createSubscription({ amount: 0 });
    expect(isPaidSubscription(sub)).toBe(false);
  });

  it('should return false for subscription with undefined amount', () => {
    const sub = createSubscription({ amount: undefined });
    expect(isPaidSubscription(sub)).toBe(false);
  });
});

describe('Integration: status active + isPaidSubscription', () => {
  it('should correctly identify cancelled paid subscription with status active as granting access', () => {
    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 1);
    const sub = createSubscription({
      status: 'active',
      amount: 2000,
      cancelledAt: '2024-06-01T00:00:00Z',
      endDate: futureDate.toISOString(),
    });
    
    expect(sub.status === 'active').toBe(true);
    expect(isPaidSubscription(sub)).toBe(true);
    // This combination should grant access
    expect(sub.status === 'active' && isPaidSubscription(sub)).toBe(true);
  });

  it('should correctly identify expired subscription as not granting access', () => {
    const sub = createSubscription({
      status: 'expired',
      amount: 2000,
      cancelledAt: '2024-06-01T00:00:00Z',
      endDate: '2024-01-01T00:00:00Z', // Past date
    });
    
    expect(sub.status === 'active').toBe(false);
    expect(isPaidSubscription(sub)).toBe(true);
    // This combination should NOT grant access
    expect(sub.status === 'active' && isPaidSubscription(sub)).toBe(false);
  });
});
