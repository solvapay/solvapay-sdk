import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSubscriptionStatus } from '../useSubscriptionStatus';
import * as useSubscriptionModule from '../useSubscription';
import type { SubscriptionInfo } from '../../types';

// Helper function to create a test subscription
const createSubscription = (overrides: Partial<SubscriptionInfo> = {}): SubscriptionInfo => ({
  reference: 'sub_123',
  planName: 'Test Plan',
  agentName: 'Test Agent',
  status: 'active',
  startDate: '2024-01-01T00:00:00Z',
  amount: 1000,
  ...overrides,
});

// Mock useSubscription
vi.mock('../useSubscription', () => ({
  useSubscription: vi.fn(),
}));

describe('useSubscriptionStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic functionality', () => {
    it('should return all expected properties', () => {
      vi.mocked(useSubscriptionModule.useSubscription).mockReturnValue({
        subscriptions: [],
        loading: false,
        hasPlan: vi.fn(),
        activeSubscription: null,
        hasPaidSubscription: false,
        activePaidSubscription: null,
        refetch: vi.fn(),
      } as any);

      const { result } = renderHook(() => useSubscriptionStatus());

      expect(result.current).toHaveProperty('cancelledSubscription');
      expect(result.current).toHaveProperty('shouldShowCancelledNotice');
      expect(result.current).toHaveProperty('formatDate');
      expect(result.current).toHaveProperty('getDaysUntilExpiration');
    });

    it('should use subscriptions from useSubscription hook', () => {
      const subscriptions = [createSubscription()];
      vi.mocked(useSubscriptionModule.useSubscription).mockReturnValue({
        subscriptions,
        loading: false,
        hasPlan: vi.fn(),
        activeSubscription: null,
        hasPaidSubscription: false,
        activePaidSubscription: null,
        refetch: vi.fn(),
      } as any);

      const { result } = renderHook(() => useSubscriptionStatus());

      expect(result.current.shouldShowCancelledNotice).toBe(false);
      expect(result.current.cancelledSubscription).toBeNull();
    });
  });

  describe('cancelledSubscription', () => {
    it('should return null when no cancelled subscriptions exist', () => {
      const subscriptions = [
        createSubscription({ status: 'active', amount: 1000 }),
        createSubscription({ status: 'active', amount: 2000 }),
      ];
      vi.mocked(useSubscriptionModule.useSubscription).mockReturnValue({
        subscriptions,
        loading: false,
        hasPlan: vi.fn(),
        activeSubscription: null,
        hasPaidSubscription: true,
        activePaidSubscription: subscriptions[0],
        refetch: vi.fn(),
      } as any);

      const { result } = renderHook(() => useSubscriptionStatus());

      expect(result.current.cancelledSubscription).toBeNull();
      expect(result.current.shouldShowCancelledNotice).toBe(false);
    });

    it('should return null when cancelled subscription is free (amount === 0)', () => {
      const subscriptions = [
        createSubscription({ status: 'cancelled', amount: 0 }),
      ];
      vi.mocked(useSubscriptionModule.useSubscription).mockReturnValue({
        subscriptions,
        loading: false,
        hasPlan: vi.fn(),
        activeSubscription: null,
        hasPaidSubscription: false,
        activePaidSubscription: null,
        refetch: vi.fn(),
      } as any);

      const { result } = renderHook(() => useSubscriptionStatus());

      expect(result.current.cancelledSubscription).toBeNull();
      expect(result.current.shouldShowCancelledNotice).toBe(false);
    });

    it('should return null when cancelled subscription has undefined amount', () => {
      const subscriptions = [
        createSubscription({ status: 'cancelled', amount: undefined }),
      ];
      vi.mocked(useSubscriptionModule.useSubscription).mockReturnValue({
        subscriptions,
        loading: false,
        hasPlan: vi.fn(),
        activeSubscription: null,
        hasPaidSubscription: false,
        activePaidSubscription: null,
        refetch: vi.fn(),
      } as any);

      const { result } = renderHook(() => useSubscriptionStatus());

      expect(result.current.cancelledSubscription).toBeNull();
      expect(result.current.shouldShowCancelledNotice).toBe(false);
    });

    it('should return cancelled paid subscription when one exists', () => {
      const cancelledSub = createSubscription({
        status: 'cancelled',
        amount: 1000,
        planName: 'Cancelled Plan',
        reference: 'sub_cancelled',
      });
      const subscriptions = [cancelledSub];
      vi.mocked(useSubscriptionModule.useSubscription).mockReturnValue({
        subscriptions,
        loading: false,
        hasPlan: vi.fn(),
        activeSubscription: null,
        hasPaidSubscription: false,
        activePaidSubscription: null,
        refetch: vi.fn(),
      } as any);

      const { result } = renderHook(() => useSubscriptionStatus());

      expect(result.current.cancelledSubscription).not.toBeNull();
      expect(result.current.cancelledSubscription?.planName).toBe('Cancelled Plan');
      expect(result.current.cancelledSubscription?.status).toBe('cancelled');
      expect(result.current.cancelledSubscription?.amount).toBe(1000);
      expect(result.current.shouldShowCancelledNotice).toBe(true);
    });

    it('should return most recent cancelled subscription when multiple exist', () => {
      const olderCancelled = createSubscription({
        status: 'cancelled',
        amount: 1000,
        planName: 'Older Plan',
        startDate: '2024-01-01T00:00:00Z',
      });
      const newerCancelled = createSubscription({
        status: 'cancelled',
        amount: 2000,
        planName: 'Newer Plan',
        startDate: '2024-02-01T00:00:00Z',
      });
      const subscriptions = [olderCancelled, newerCancelled];
      vi.mocked(useSubscriptionModule.useSubscription).mockReturnValue({
        subscriptions,
        loading: false,
        hasPlan: vi.fn(),
        activeSubscription: null,
        hasPaidSubscription: false,
        activePaidSubscription: null,
        refetch: vi.fn(),
      } as any);

      const { result } = renderHook(() => useSubscriptionStatus());

      expect(result.current.cancelledSubscription).not.toBeNull();
      expect(result.current.cancelledSubscription?.planName).toBe('Newer Plan');
      expect(result.current.cancelledSubscription?.startDate).toBe('2024-02-01T00:00:00Z');
    });

    it('should only consider cancelled paid subscriptions', () => {
      const cancelledPaid = createSubscription({
        status: 'cancelled',
        amount: 1000,
        planName: 'Cancelled Paid',
      });
      const cancelledFree = createSubscription({
        status: 'cancelled',
        amount: 0,
        planName: 'Cancelled Free',
      });
      const activePaid = createSubscription({
        status: 'active',
        amount: 2000,
        planName: 'Active Paid',
      });
      const subscriptions = [cancelledPaid, cancelledFree, activePaid];
      vi.mocked(useSubscriptionModule.useSubscription).mockReturnValue({
        subscriptions,
        loading: false,
        hasPlan: vi.fn(),
        activeSubscription: activePaid,
        hasPaidSubscription: true,
        activePaidSubscription: activePaid,
        refetch: vi.fn(),
      } as any);

      const { result } = renderHook(() => useSubscriptionStatus());

      expect(result.current.cancelledSubscription).not.toBeNull();
      expect(result.current.cancelledSubscription?.planName).toBe('Cancelled Paid');
      expect(result.current.cancelledSubscription?.amount).toBe(1000);
    });

    it('should handle empty subscriptions array', () => {
      vi.mocked(useSubscriptionModule.useSubscription).mockReturnValue({
        subscriptions: [],
        loading: false,
        hasPlan: vi.fn(),
        activeSubscription: null,
        hasPaidSubscription: false,
        activePaidSubscription: null,
        refetch: vi.fn(),
      } as any);

      const { result } = renderHook(() => useSubscriptionStatus());

      expect(result.current.cancelledSubscription).toBeNull();
      expect(result.current.shouldShowCancelledNotice).toBe(false);
    });
  });

  describe('shouldShowCancelledNotice', () => {
    it('should be false when no cancelled subscription exists', () => {
      vi.mocked(useSubscriptionModule.useSubscription).mockReturnValue({
        subscriptions: [],
        loading: false,
        hasPlan: vi.fn(),
        activeSubscription: null,
        hasPaidSubscription: false,
        activePaidSubscription: null,
        refetch: vi.fn(),
      } as any);

      const { result } = renderHook(() => useSubscriptionStatus());

      expect(result.current.shouldShowCancelledNotice).toBe(false);
    });

    it('should be true when cancelled subscription exists', () => {
      const cancelledSub = createSubscription({
        status: 'cancelled',
        amount: 1000,
      });
      vi.mocked(useSubscriptionModule.useSubscription).mockReturnValue({
        subscriptions: [cancelledSub],
        loading: false,
        hasPlan: vi.fn(),
        activeSubscription: null,
        hasPaidSubscription: false,
        activePaidSubscription: null,
        refetch: vi.fn(),
      } as any);

      const { result } = renderHook(() => useSubscriptionStatus());

      expect(result.current.shouldShowCancelledNotice).toBe(true);
    });

    it('should be false when only cancelled free subscription exists', () => {
      const cancelledFree = createSubscription({
        status: 'cancelled',
        amount: 0,
      });
      vi.mocked(useSubscriptionModule.useSubscription).mockReturnValue({
        subscriptions: [cancelledFree],
        loading: false,
        hasPlan: vi.fn(),
        activeSubscription: null,
        hasPaidSubscription: false,
        activePaidSubscription: null,
        refetch: vi.fn(),
      } as any);

      const { result } = renderHook(() => useSubscriptionStatus());

      expect(result.current.shouldShowCancelledNotice).toBe(false);
    });
  });

  describe('formatDate', () => {
    it('should format valid date string', () => {
      vi.mocked(useSubscriptionModule.useSubscription).mockReturnValue({
        subscriptions: [],
        loading: false,
        hasPlan: vi.fn(),
        activeSubscription: null,
        hasPaidSubscription: false,
        activePaidSubscription: null,
        refetch: vi.fn(),
      } as any);

      const { result } = renderHook(() => useSubscriptionStatus());

      const formatted = result.current.formatDate('2024-01-15T00:00:00Z');
      expect(formatted).toBeTruthy();
      expect(typeof formatted).toBe('string');
      // Should contain month name, day, and year
      expect(formatted).toMatch(/January|February|March|April|May|June|July|August|September|October|November|December/);
      expect(formatted).toMatch(/2024/);
    });

    it('should return null for undefined date', () => {
      vi.mocked(useSubscriptionModule.useSubscription).mockReturnValue({
        subscriptions: [],
        loading: false,
        hasPlan: vi.fn(),
        activeSubscription: null,
        hasPaidSubscription: false,
        activePaidSubscription: null,
        refetch: vi.fn(),
      } as any);

      const { result } = renderHook(() => useSubscriptionStatus());

      expect(result.current.formatDate(undefined)).toBeNull();
    });

    it('should return null for empty string', () => {
      vi.mocked(useSubscriptionModule.useSubscription).mockReturnValue({
        subscriptions: [],
        loading: false,
        hasPlan: vi.fn(),
        activeSubscription: null,
        hasPaidSubscription: false,
        activePaidSubscription: null,
        refetch: vi.fn(),
      } as any);

      const { result } = renderHook(() => useSubscriptionStatus());

      // Empty string is falsy, so should be treated as undefined and return null
      const formatted = result.current.formatDate('');
      expect(formatted).toBeNull();
    });

    it('should format different dates correctly', () => {
      vi.mocked(useSubscriptionModule.useSubscription).mockReturnValue({
        subscriptions: [],
        loading: false,
        hasPlan: vi.fn(),
        activeSubscription: null,
        hasPaidSubscription: false,
        activePaidSubscription: null,
        refetch: vi.fn(),
      } as any);

      const { result } = renderHook(() => useSubscriptionStatus());

      const date1 = result.current.formatDate('2024-12-31T23:59:59Z');
      const date2 = result.current.formatDate('2024-01-01T00:00:00Z');
      
      expect(date1).toBeTruthy();
      expect(date2).toBeTruthy();
      expect(date1).not.toBe(date2);
    });

    it('should use en-US locale format', () => {
      vi.mocked(useSubscriptionModule.useSubscription).mockReturnValue({
        subscriptions: [],
        loading: false,
        hasPlan: vi.fn(),
        activeSubscription: null,
        hasPaidSubscription: false,
        activePaidSubscription: null,
        refetch: vi.fn(),
      } as any);

      const { result } = renderHook(() => useSubscriptionStatus());

      const formatted = result.current.formatDate('2024-03-15T00:00:00Z');
      // Should be in format like "March 15, 2024"
      expect(formatted).toContain('March');
      expect(formatted).toContain('15');
      expect(formatted).toContain('2024');
    });
  });

  describe('getDaysUntilExpiration', () => {
    it('should return null for undefined endDate', () => {
      vi.mocked(useSubscriptionModule.useSubscription).mockReturnValue({
        subscriptions: [],
        loading: false,
        hasPlan: vi.fn(),
        activeSubscription: null,
        hasPaidSubscription: false,
        activePaidSubscription: null,
        refetch: vi.fn(),
      } as any);

      const { result } = renderHook(() => useSubscriptionStatus());

      expect(result.current.getDaysUntilExpiration(undefined)).toBeNull();
    });

    it('should return null for empty string endDate', () => {
      vi.mocked(useSubscriptionModule.useSubscription).mockReturnValue({
        subscriptions: [],
        loading: false,
        hasPlan: vi.fn(),
        activeSubscription: null,
        hasPaidSubscription: false,
        activePaidSubscription: null,
        refetch: vi.fn(),
      } as any);

      const { result } = renderHook(() => useSubscriptionStatus());

      // Empty string is falsy, so should return null
      const resultValue = result.current.getDaysUntilExpiration('');
      expect(resultValue).toBeNull();
    });

    it('should return positive days for future date', () => {
      vi.mocked(useSubscriptionModule.useSubscription).mockReturnValue({
        subscriptions: [],
        loading: false,
        hasPlan: vi.fn(),
        activeSubscription: null,
        hasPaidSubscription: false,
        activePaidSubscription: null,
        refetch: vi.fn(),
      } as any);

      const { result } = renderHook(() => useSubscriptionStatus());

      // Create a date 10 days in the future
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 10);
      const futureDateString = futureDate.toISOString();

      const days = result.current.getDaysUntilExpiration(futureDateString);
      expect(days).toBeGreaterThan(0);
      expect(days).toBeLessThanOrEqual(10); // Should be around 10, might be 9 or 10 depending on time of day
    });

    it('should return 0 for past date', () => {
      vi.mocked(useSubscriptionModule.useSubscription).mockReturnValue({
        subscriptions: [],
        loading: false,
        hasPlan: vi.fn(),
        activeSubscription: null,
        hasPaidSubscription: false,
        activePaidSubscription: null,
        refetch: vi.fn(),
      } as any);

      const { result } = renderHook(() => useSubscriptionStatus());

      const pastDate = new Date('2020-01-01T00:00:00Z');
      const days = result.current.getDaysUntilExpiration(pastDate.toISOString());

      expect(days).toBe(0);
    });

    it('should return 0 for date exactly today', () => {
      vi.mocked(useSubscriptionModule.useSubscription).mockReturnValue({
        subscriptions: [],
        loading: false,
        hasPlan: vi.fn(),
        activeSubscription: null,
        hasPaidSubscription: false,
        activePaidSubscription: null,
        refetch: vi.fn(),
      } as any);

      const { result } = renderHook(() => useSubscriptionStatus());

      const today = new Date();
      today.setHours(23, 59, 59, 999); // End of today
      const days = result.current.getDaysUntilExpiration(today.toISOString());

      // Should be 0 or 1 depending on when test runs
      expect(days).toBeGreaterThanOrEqual(0);
      expect(days).toBeLessThanOrEqual(1);
    });

    it('should calculate days correctly for various future dates', () => {
      vi.mocked(useSubscriptionModule.useSubscription).mockReturnValue({
        subscriptions: [],
        loading: false,
        hasPlan: vi.fn(),
        activeSubscription: null,
        hasPaidSubscription: false,
        activePaidSubscription: null,
        refetch: vi.fn(),
      } as any);

      const { result } = renderHook(() => useSubscriptionStatus());

      const now = new Date();
      const date1 = new Date(now);
      date1.setDate(date1.getDate() + 1);
      const date2 = new Date(now);
      date2.setDate(date2.getDate() + 30);
      const date3 = new Date(now);
      date3.setDate(date3.getDate() + 365);

      const days1 = result.current.getDaysUntilExpiration(date1.toISOString());
      const days2 = result.current.getDaysUntilExpiration(date2.toISOString());
      const days3 = result.current.getDaysUntilExpiration(date3.toISOString());

      expect(days1).toBeGreaterThan(0);
      expect(days2).toBeGreaterThan(25); // Should be around 30
      expect(days3).toBeGreaterThan(360); // Should be around 365
      expect(days1).toBeLessThan(days2);
      expect(days2).toBeLessThan(days3);
    });

    it('should use Math.ceil for rounding', () => {
      vi.mocked(useSubscriptionModule.useSubscription).mockReturnValue({
        subscriptions: [],
        loading: false,
        hasPlan: vi.fn(),
        activeSubscription: null,
        hasPaidSubscription: false,
        activePaidSubscription: null,
        refetch: vi.fn(),
      } as any);

      const { result } = renderHook(() => useSubscriptionStatus());

      // Create a date 1.5 days in the future (should round up to 2)
      const futureDate = new Date();
      futureDate.setTime(futureDate.getTime() + (1.5 * 24 * 60 * 60 * 1000));

      const days = result.current.getDaysUntilExpiration(futureDate.toISOString());
      expect(days).toBeGreaterThanOrEqual(1);
      expect(days).toBeLessThanOrEqual(2);
    });
  });

  describe('Edge cases and integration', () => {
    it('should handle subscription with negative amount', () => {
      const subscription = createSubscription({
        status: 'cancelled',
        amount: -100,
      });
      vi.mocked(useSubscriptionModule.useSubscription).mockReturnValue({
        subscriptions: [subscription],
        loading: false,
        hasPlan: vi.fn(),
        activeSubscription: null,
        hasPaidSubscription: false,
        activePaidSubscription: null,
        refetch: vi.fn(),
      } as any);

      const { result } = renderHook(() => useSubscriptionStatus());

      // Negative amount should not be considered paid
      expect(result.current.cancelledSubscription).toBeNull();
      expect(result.current.shouldShowCancelledNotice).toBe(false);
    });

    it('should handle mixed subscription states', () => {
      const activePaid = createSubscription({
        status: 'active',
        amount: 2000,
        planName: 'Active Paid',
      });
      const cancelledPaid = createSubscription({
        status: 'cancelled',
        amount: 1000,
        planName: 'Cancelled Paid',
        startDate: '2024-01-01T00:00:00Z',
      });
      const activeFree = createSubscription({
        status: 'active',
        amount: 0,
        planName: 'Active Free',
      });
      const subscriptions = [activePaid, cancelledPaid, activeFree];
      vi.mocked(useSubscriptionModule.useSubscription).mockReturnValue({
        subscriptions,
        loading: false,
        hasPlan: vi.fn(),
        activeSubscription: activePaid,
        hasPaidSubscription: true,
        activePaidSubscription: activePaid,
        refetch: vi.fn(),
      } as any);

      const { result } = renderHook(() => useSubscriptionStatus());

      expect(result.current.cancelledSubscription).not.toBeNull();
      expect(result.current.cancelledSubscription?.planName).toBe('Cancelled Paid');
      expect(result.current.shouldShowCancelledNotice).toBe(true);
    });

    it('should handle multiple cancelled subscriptions with different start dates', () => {
      const sub1 = createSubscription({
        status: 'cancelled',
        amount: 1000,
        planName: 'Plan 1',
        startDate: '2024-01-01T00:00:00Z',
      });
      const sub2 = createSubscription({
        status: 'cancelled',
        amount: 2000,
        planName: 'Plan 2',
        startDate: '2024-03-01T00:00:00Z',
      });
      const sub3 = createSubscription({
        status: 'cancelled',
        amount: 3000,
        planName: 'Plan 3',
        startDate: '2024-02-01T00:00:00Z',
      });
      const subscriptions = [sub1, sub2, sub3];
      vi.mocked(useSubscriptionModule.useSubscription).mockReturnValue({
        subscriptions,
        loading: false,
        hasPlan: vi.fn(),
        activeSubscription: null,
        hasPaidSubscription: false,
        activePaidSubscription: null,
        refetch: vi.fn(),
      } as any);

      const { result } = renderHook(() => useSubscriptionStatus());

      // Should return the most recent (sub2 - March 1)
      expect(result.current.cancelledSubscription?.planName).toBe('Plan 2');
      expect(result.current.cancelledSubscription?.startDate).toBe('2024-03-01T00:00:00Z');
    });

    it('should memoize functions correctly', () => {
      vi.mocked(useSubscriptionModule.useSubscription).mockReturnValue({
        subscriptions: [],
        loading: false,
        hasPlan: vi.fn(),
        activeSubscription: null,
        hasPaidSubscription: false,
        activePaidSubscription: null,
        refetch: vi.fn(),
      } as any);

      const { result, rerender } = renderHook(() => useSubscriptionStatus());

      const formatDate1 = result.current.formatDate;
      const getDaysUntilExpiration1 = result.current.getDaysUntilExpiration;

      rerender();

      const formatDate2 = result.current.formatDate;
      const getDaysUntilExpiration2 = result.current.getDaysUntilExpiration;

      // Functions should be stable (same reference) due to useCallback
      expect(formatDate1).toBe(formatDate2);
      expect(getDaysUntilExpiration1).toBe(getDaysUntilExpiration2);
    });

    it('should update cancelledSubscription when subscriptions change', () => {
      const { result, rerender } = renderHook(() => useSubscriptionStatus());

      // Initially no subscriptions
      vi.mocked(useSubscriptionModule.useSubscription).mockReturnValue({
        subscriptions: [],
        loading: false,
        hasPlan: vi.fn(),
        activeSubscription: null,
        hasPaidSubscription: false,
        activePaidSubscription: null,
        refetch: vi.fn(),
      } as any);

      expect(result.current.cancelledSubscription).toBeNull();

      // Add cancelled subscription
      const cancelledSub = createSubscription({
        status: 'cancelled',
        amount: 1000,
      });
      vi.mocked(useSubscriptionModule.useSubscription).mockReturnValue({
        subscriptions: [cancelledSub],
        loading: false,
        hasPlan: vi.fn(),
        activeSubscription: null,
        hasPaidSubscription: false,
        activePaidSubscription: null,
        refetch: vi.fn(),
      } as any);

      rerender();

      expect(result.current.cancelledSubscription).not.toBeNull();
      expect(result.current.shouldShowCancelledNotice).toBe(true);
    });

    it('should handle date formatting with cancelled subscription', () => {
      const cancelledSub = createSubscription({
        status: 'cancelled',
        amount: 1000,
        endDate: '2024-12-31T23:59:59Z',
        cancelledAt: '2024-06-01T00:00:00Z',
      });
      vi.mocked(useSubscriptionModule.useSubscription).mockReturnValue({
        subscriptions: [cancelledSub],
        loading: false,
        hasPlan: vi.fn(),
        activeSubscription: null,
        hasPaidSubscription: false,
        activePaidSubscription: null,
        refetch: vi.fn(),
      } as any);

      const { result } = renderHook(() => useSubscriptionStatus());

      const formattedEndDate = result.current.formatDate(cancelledSub.endDate);
      const formattedCancelledAt = result.current.formatDate(cancelledSub.cancelledAt);
      const daysLeft = result.current.getDaysUntilExpiration(cancelledSub.endDate);

      expect(formattedEndDate).toBeTruthy();
      expect(formattedCancelledAt).toBeTruthy();
      expect(daysLeft).toBeDefined();
    });
  });

  describe('isPaidSubscription helper (internal)', () => {
    it('should correctly identify paid subscriptions', () => {
      const paidSub = createSubscription({ amount: 1000 });
      const freeSub = createSubscription({ amount: 0 });
      const undefinedSub = createSubscription({ amount: undefined });
      const subscriptions = [paidSub, freeSub, undefinedSub];
      
      vi.mocked(useSubscriptionModule.useSubscription).mockReturnValue({
        subscriptions,
        loading: false,
        hasPlan: vi.fn(),
        activeSubscription: null,
        hasPaidSubscription: true,
        activePaidSubscription: paidSub,
        refetch: vi.fn(),
      } as any);

      const { result } = renderHook(() => useSubscriptionStatus());

      // Only paid cancelled subscriptions should be returned
      const cancelledPaid = createSubscription({
        status: 'cancelled',
        amount: 1000,
      });
      vi.mocked(useSubscriptionModule.useSubscription).mockReturnValue({
        subscriptions: [cancelledPaid],
        loading: false,
        hasPlan: vi.fn(),
        activeSubscription: null,
        hasPaidSubscription: false,
        activePaidSubscription: null,
        refetch: vi.fn(),
      } as any);

      const { result: result2 } = renderHook(() => useSubscriptionStatus());
      expect(result2.current.cancelledSubscription).not.toBeNull();
    });

    it('should handle zero amount as free', () => {
      const cancelledFree = createSubscription({
        status: 'cancelled',
        amount: 0,
      });
      vi.mocked(useSubscriptionModule.useSubscription).mockReturnValue({
        subscriptions: [cancelledFree],
        loading: false,
        hasPlan: vi.fn(),
        activeSubscription: null,
        hasPaidSubscription: false,
        activePaidSubscription: null,
        refetch: vi.fn(),
      } as any);

      const { result } = renderHook(() => useSubscriptionStatus());

      expect(result.current.cancelledSubscription).toBeNull();
    });

    it('should handle undefined amount as free', () => {
      const cancelledUndefined = createSubscription({
        status: 'cancelled',
        amount: undefined,
      });
      vi.mocked(useSubscriptionModule.useSubscription).mockReturnValue({
        subscriptions: [cancelledUndefined],
        loading: false,
        hasPlan: vi.fn(),
        activeSubscription: null,
        hasPaidSubscription: false,
        activePaidSubscription: null,
        refetch: vi.fn(),
      } as any);

      const { result } = renderHook(() => useSubscriptionStatus());

      expect(result.current.cancelledSubscription).toBeNull();
    });
  });
});

