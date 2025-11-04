import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSubscription } from '../useSubscription';
import * as useSolvaPayModule from '../useSolvaPay';
import type { SubscriptionStatus, SubscriptionInfo, SolvaPayContextValue } from '../../types';

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

// Helper function to create mock subscription status
const createMockSubscriptionStatus = (
  overrides: Partial<SubscriptionStatus> = {}
): SubscriptionStatus => ({
  loading: false,
  subscriptions: [],
  hasPlan: vi.fn(() => false),
  activeSubscription: null,
  hasPaidSubscription: false,
  activePaidSubscription: null,
  ...overrides,
});

// Helper function to create mock context value
const createMockContextValue = (
  subscription: SubscriptionStatus,
  refetchSubscription: () => Promise<void> = vi.fn(() => Promise.resolve())
): SolvaPayContextValue => ({
  subscription,
  refetchSubscription,
  createPayment: vi.fn(),
  customerRef: 'test_customer_ref',
});

// Mock useSolvaPay
vi.mock('../useSolvaPay', () => ({
  useSolvaPay: vi.fn(),
}));

describe('useSubscription', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic functionality', () => {
    it('should return subscription status from context', () => {
      const mockSubscription = createMockSubscriptionStatus({
        loading: false,
        subscriptions: [createSubscription()],
      });
      const mockRefetch = vi.fn(() => Promise.resolve());
      const mockContextValue = createMockContextValue(mockSubscription, mockRefetch);

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue);

      const { result } = renderHook(() => useSubscription());

      expect(result.current.loading).toBe(false);
      expect(result.current.subscriptions).toHaveLength(1);
      expect(result.current.subscriptions[0].planName).toBe('Test Plan');
    });

    it('should return refetch function', () => {
      const mockSubscription = createMockSubscriptionStatus();
      const mockRefetch = vi.fn(() => Promise.resolve());
      const mockContextValue = createMockContextValue(mockSubscription, mockRefetch);

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue);

      const { result } = renderHook(() => useSubscription());

      expect(result.current.refetch).toBeDefined();
      expect(typeof result.current.refetch).toBe('function');
    });

    it('should spread all subscription status properties', () => {
      const mockSubscription = createMockSubscriptionStatus({
        loading: true,
        customerRef: 'customer_123',
        email: 'test@example.com',
        name: 'Test User',
        subscriptions: [createSubscription()],
      });
      const mockContextValue = createMockContextValue(mockSubscription);

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue);

      const { result } = renderHook(() => useSubscription());

      expect(result.current.loading).toBe(true);
      expect(result.current.customerRef).toBe('customer_123');
      expect(result.current.email).toBe('test@example.com');
      expect(result.current.name).toBe('Test User');
      expect(result.current.subscriptions).toHaveLength(1);
    });
  });

  describe('Loading state', () => {
    it('should return loading: true when context indicates loading', () => {
      const mockSubscription = createMockSubscriptionStatus({ loading: true });
      const mockContextValue = createMockContextValue(mockSubscription);

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue);

      const { result } = renderHook(() => useSubscription());

      expect(result.current.loading).toBe(true);
    });

    it('should return loading: false when context indicates not loading', () => {
      const mockSubscription = createMockSubscriptionStatus({ loading: false });
      const mockContextValue = createMockContextValue(mockSubscription);

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue);

      const { result } = renderHook(() => useSubscription());

      expect(result.current.loading).toBe(false);
    });
  });

  describe('Subscriptions array', () => {
    it('should return empty subscriptions array when no subscriptions exist', () => {
      const mockSubscription = createMockSubscriptionStatus({ subscriptions: [] });
      const mockContextValue = createMockContextValue(mockSubscription);

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue);

      const { result } = renderHook(() => useSubscription());

      expect(result.current.subscriptions).toEqual([]);
      expect(result.current.subscriptions).toHaveLength(0);
    });

    it('should return single subscription when one subscription exists', () => {
      const subscription = createSubscription({ planName: 'Pro Plan' });
      const mockSubscription = createMockSubscriptionStatus({
        subscriptions: [subscription],
      });
      const mockContextValue = createMockContextValue(mockSubscription);

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue);

      const { result } = renderHook(() => useSubscription());

      expect(result.current.subscriptions).toHaveLength(1);
      expect(result.current.subscriptions[0].planName).toBe('Pro Plan');
    });

    it('should return multiple subscriptions when multiple exist', () => {
      const subscriptions = [
        createSubscription({ planName: 'Plan 1', reference: 'sub_1' }),
        createSubscription({ planName: 'Plan 2', reference: 'sub_2' }),
        createSubscription({ planName: 'Plan 3', reference: 'sub_3' }),
      ];
      const mockSubscription = createMockSubscriptionStatus({ subscriptions });
      const mockContextValue = createMockContextValue(mockSubscription);

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue);

      const { result } = renderHook(() => useSubscription());

      expect(result.current.subscriptions).toHaveLength(3);
      expect(result.current.subscriptions[0].planName).toBe('Plan 1');
      expect(result.current.subscriptions[1].planName).toBe('Plan 2');
      expect(result.current.subscriptions[2].planName).toBe('Plan 3');
    });
  });

  describe('activeSubscription', () => {
    it('should return null when no active subscription exists', () => {
      const mockSubscription = createMockSubscriptionStatus({
        activeSubscription: null,
      });
      const mockContextValue = createMockContextValue(mockSubscription);

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue);

      const { result } = renderHook(() => useSubscription());

      expect(result.current.activeSubscription).toBeNull();
    });

    it('should return active subscription when one exists', () => {
      const activeSub = createSubscription({ planName: 'Active Plan' });
      const mockSubscription = createMockSubscriptionStatus({
        activeSubscription: activeSub,
      });
      const mockContextValue = createMockContextValue(mockSubscription);

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue);

      const { result } = renderHook(() => useSubscription());

      expect(result.current.activeSubscription).not.toBeNull();
      expect(result.current.activeSubscription?.planName).toBe('Active Plan');
    });

    it('should return free plan as activeSubscription when free plan is active', () => {
      const freeSub = createSubscription({
        planName: 'Free Plan',
        amount: 0,
      });
      const mockSubscription = createMockSubscriptionStatus({
        activeSubscription: freeSub,
      });
      const mockContextValue = createMockContextValue(mockSubscription);

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue);

      const { result } = renderHook(() => useSubscription());

      expect(result.current.activeSubscription).not.toBeNull();
      expect(result.current.activeSubscription?.planName).toBe('Free Plan');
      expect(result.current.activeSubscription?.amount).toBe(0);
    });

    it('should return paid plan as activeSubscription when paid plan is active', () => {
      const paidSub = createSubscription({
        planName: 'Paid Plan',
        amount: 2000,
      });
      const mockSubscription = createMockSubscriptionStatus({
        activeSubscription: paidSub,
      });
      const mockContextValue = createMockContextValue(mockSubscription);

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue);

      const { result } = renderHook(() => useSubscription());

      expect(result.current.activeSubscription).not.toBeNull();
      expect(result.current.activeSubscription?.planName).toBe('Paid Plan');
      expect(result.current.activeSubscription?.amount).toBe(2000);
    });
  });

  describe('hasPaidSubscription', () => {
    it('should return false when no paid subscriptions exist', () => {
      const mockSubscription = createMockSubscriptionStatus({
        hasPaidSubscription: false,
      });
      const mockContextValue = createMockContextValue(mockSubscription);

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue);

      const { result } = renderHook(() => useSubscription());

      expect(result.current.hasPaidSubscription).toBe(false);
    });

    it('should return true when paid subscription exists', () => {
      const mockSubscription = createMockSubscriptionStatus({
        hasPaidSubscription: true,
      });
      const mockContextValue = createMockContextValue(mockSubscription);

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue);

      const { result } = renderHook(() => useSubscription());

      expect(result.current.hasPaidSubscription).toBe(true);
    });

    it('should return false when only free subscriptions exist', () => {
      const freeSub = createSubscription({ amount: 0 });
      const mockSubscription = createMockSubscriptionStatus({
        subscriptions: [freeSub],
        hasPaidSubscription: false,
        activeSubscription: freeSub,
      });
      const mockContextValue = createMockContextValue(mockSubscription);

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue);

      const { result } = renderHook(() => useSubscription());

      expect(result.current.hasPaidSubscription).toBe(false);
    });
  });

  describe('activePaidSubscription', () => {
    it('should return null when no paid subscription exists', () => {
      const mockSubscription = createMockSubscriptionStatus({
        activePaidSubscription: null,
      });
      const mockContextValue = createMockContextValue(mockSubscription);

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue);

      const { result } = renderHook(() => useSubscription());

      expect(result.current.activePaidSubscription).toBeNull();
    });

    it('should return paid subscription when one exists', () => {
      const paidSub = createSubscription({
        planName: 'Premium Plan',
        amount: 5000,
      });
      const mockSubscription = createMockSubscriptionStatus({
        activePaidSubscription: paidSub,
      });
      const mockContextValue = createMockContextValue(mockSubscription);

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue);

      const { result } = renderHook(() => useSubscription());

      expect(result.current.activePaidSubscription).not.toBeNull();
      expect(result.current.activePaidSubscription?.planName).toBe('Premium Plan');
      expect(result.current.activePaidSubscription?.amount).toBe(5000);
    });

    it('should return null when only free subscriptions exist', () => {
      const freeSub = createSubscription({ amount: 0 });
      const mockSubscription = createMockSubscriptionStatus({
        activePaidSubscription: null,
        activeSubscription: freeSub,
      });
      const mockContextValue = createMockContextValue(mockSubscription);

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue);

      const { result } = renderHook(() => useSubscription());

      expect(result.current.activePaidSubscription).toBeNull();
    });
  });

  describe('hasPlan function', () => {
    it('should return hasPlan function from context', () => {
      const mockHasPlan = vi.fn(() => true);
      const mockSubscription = createMockSubscriptionStatus({
        hasPlan: mockHasPlan,
      });
      const mockContextValue = createMockContextValue(mockSubscription);

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue);

      const { result } = renderHook(() => useSubscription());

      expect(result.current.hasPlan).toBeDefined();
      expect(typeof result.current.hasPlan).toBe('function');
      expect(result.current.hasPlan('Test Plan')).toBe(true);
      expect(mockHasPlan).toHaveBeenCalledWith('Test Plan');
    });

    it('should return false when hasPlan returns false', () => {
      const mockHasPlan = vi.fn(() => false);
      const mockSubscription = createMockSubscriptionStatus({
        hasPlan: mockHasPlan,
      });
      const mockContextValue = createMockContextValue(mockSubscription);

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue);

      const { result } = renderHook(() => useSubscription());

      expect(result.current.hasPlan('Non-existent Plan')).toBe(false);
      expect(mockHasPlan).toHaveBeenCalledWith('Non-existent Plan');
    });
  });

  describe('Customer information', () => {
    it('should return customerRef when provided', () => {
      const mockSubscription = createMockSubscriptionStatus({
        customerRef: 'customer_abc123',
      });
      const mockContextValue = createMockContextValue(mockSubscription);

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue);

      const { result } = renderHook(() => useSubscription());

      expect(result.current.customerRef).toBe('customer_abc123');
    });

    it('should return undefined when customerRef is not provided', () => {
      const mockSubscription = createMockSubscriptionStatus({
        customerRef: undefined,
      });
      const mockContextValue = createMockContextValue(mockSubscription);

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue);

      const { result } = renderHook(() => useSubscription());

      expect(result.current.customerRef).toBeUndefined();
    });

    it('should return email when provided', () => {
      const mockSubscription = createMockSubscriptionStatus({
        email: 'user@example.com',
      });
      const mockContextValue = createMockContextValue(mockSubscription);

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue);

      const { result } = renderHook(() => useSubscription());

      expect(result.current.email).toBe('user@example.com');
    });

    it('should return name when provided', () => {
      const mockSubscription = createMockSubscriptionStatus({
        name: 'John Doe',
      });
      const mockContextValue = createMockContextValue(mockSubscription);

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue);

      const { result } = renderHook(() => useSubscription());

      expect(result.current.name).toBe('John Doe');
    });
  });

  describe('Refetch function', () => {
    it('should call refetchSubscription from context when refetch is called', async () => {
      const mockRefetch = vi.fn(() => Promise.resolve());
      const mockSubscription = createMockSubscriptionStatus();
      const mockContextValue = createMockContextValue(mockSubscription, mockRefetch);

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue);

      const { result } = renderHook(() => useSubscription());

      await result.current.refetch();

      expect(mockRefetch).toHaveBeenCalledTimes(1);
    });

    it('should return a promise from refetch', async () => {
      const mockRefetch = vi.fn(() => Promise.resolve());
      const mockSubscription = createMockSubscriptionStatus();
      const mockContextValue = createMockContextValue(mockSubscription, mockRefetch);

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue);

      const { result } = renderHook(() => useSubscription());

      const refetchPromise = result.current.refetch();
      expect(refetchPromise).toBeInstanceOf(Promise);

      await refetchPromise;
      expect(mockRefetch).toHaveBeenCalled();
    });

    it('should handle refetch errors gracefully', async () => {
      const mockRefetch = vi.fn(() => Promise.reject(new Error('Refetch failed')));
      const mockSubscription = createMockSubscriptionStatus();
      const mockContextValue = createMockContextValue(mockSubscription, mockRefetch);

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue);

      const { result } = renderHook(() => useSubscription());

      await expect(result.current.refetch()).rejects.toThrow('Refetch failed');
      expect(mockRefetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('Complex scenarios', () => {
    it('should handle multiple paid subscriptions correctly', () => {
      const paidSub1 = createSubscription({
        planName: 'Premium',
        amount: 5000,
        reference: 'sub_premium',
        startDate: '2024-01-01T00:00:00Z',
      });
      const paidSub2 = createSubscription({
        planName: 'Pro',
        amount: 3000,
        reference: 'sub_pro',
        startDate: '2024-02-01T00:00:00Z',
      });
      const mockSubscription = createMockSubscriptionStatus({
        subscriptions: [paidSub1, paidSub2],
        hasPaidSubscription: true,
        activePaidSubscription: paidSub2, // Most recent
        activeSubscription: paidSub2,
      });
      const mockContextValue = createMockContextValue(mockSubscription);

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue);

      const { result } = renderHook(() => useSubscription());

      expect(result.current.hasPaidSubscription).toBe(true);
      expect(result.current.activePaidSubscription?.planName).toBe('Pro');
      expect(result.current.activeSubscription?.planName).toBe('Pro');
      expect(result.current.subscriptions).toHaveLength(2);
    });

    it('should handle mixed paid and free subscriptions', () => {
      const freeSub = createSubscription({
        planName: 'Free',
        amount: 0,
        reference: 'sub_free',
      });
      const paidSub = createSubscription({
        planName: 'Paid',
        amount: 1000,
        reference: 'sub_paid',
      });
      const mockSubscription = createMockSubscriptionStatus({
        subscriptions: [freeSub, paidSub],
        hasPaidSubscription: true,
        activePaidSubscription: paidSub,
        activeSubscription: paidSub, // Paid is primary
      });
      const mockContextValue = createMockContextValue(mockSubscription);

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue);

      const { result } = renderHook(() => useSubscription());

      expect(result.current.hasPaidSubscription).toBe(true);
      expect(result.current.activePaidSubscription?.planName).toBe('Paid');
      expect(result.current.activeSubscription?.planName).toBe('Paid');
    });

    it('should handle cancelled subscription with endDate - should still grant access until expiration', () => {
      const cancelledSub = createSubscription({
        planName: 'Cancelled Plan',
        status: 'active', // Backend keeps status as 'active' until expiration
        amount: 2000,
        endDate: '2025-12-31T23:59:59Z',
        cancelledAt: '2024-06-01T00:00:00Z',
      });
      const mockSubscription = createMockSubscriptionStatus({
        subscriptions: [cancelledSub],
        activeSubscription: cancelledSub, // Still active until endDate
        hasPaidSubscription: true, // Status is active, so still grants access
        activePaidSubscription: cancelledSub, // Status is active, so still grants access
      });
      const mockContextValue = createMockContextValue(mockSubscription);

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue);

      const { result } = renderHook(() => useSubscription());

      expect(result.current.activeSubscription?.planName).toBe('Cancelled Plan');
      expect(result.current.activeSubscription?.status).toBe('active');
      expect(result.current.hasPaidSubscription).toBe(true); // Should still grant access
      expect(result.current.activePaidSubscription?.planName).toBe('Cancelled Plan');
    });

    it('should handle empty state with no subscriptions', () => {
      const mockSubscription = createMockSubscriptionStatus({
        subscriptions: [],
        activeSubscription: null,
        hasPaidSubscription: false,
        activePaidSubscription: null,
        customerRef: undefined,
        email: undefined,
        name: undefined,
      });
      const mockContextValue = createMockContextValue(mockSubscription);

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue);

      const { result } = renderHook(() => useSubscription());

      expect(result.current.subscriptions).toEqual([]);
      expect(result.current.activeSubscription).toBeNull();
      expect(result.current.hasPaidSubscription).toBe(false);
      expect(result.current.activePaidSubscription).toBeNull();
    });
  });

  describe('Subscription properties', () => {
    it('should return all subscription properties correctly', () => {
      const subscription = createSubscription({
        reference: 'sub_full',
        planName: 'Full Plan',
        agentName: 'Full Agent',
        status: 'active',
        startDate: '2024-01-01T00:00:00Z',
        endDate: '2024-12-31T23:59:59Z',
        cancelledAt: undefined,
        cancellationReason: undefined,
        amount: 1500,
      });
      const mockSubscription = createMockSubscriptionStatus({
        subscriptions: [subscription],
        activeSubscription: subscription,
      });
      const mockContextValue = createMockContextValue(mockSubscription);

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue);

      const { result } = renderHook(() => useSubscription());

      const returnedSub = result.current.subscriptions[0];
      expect(returnedSub.reference).toBe('sub_full');
      expect(returnedSub.planName).toBe('Full Plan');
      expect(returnedSub.agentName).toBe('Full Agent');
      expect(returnedSub.status).toBe('active');
      expect(returnedSub.startDate).toBe('2024-01-01T00:00:00Z');
      expect(returnedSub.endDate).toBe('2024-12-31T23:59:59Z');
      expect(returnedSub.amount).toBe(1500);
    });

    it('should handle subscription with cancellation reason', () => {
      const subscription = createSubscription({
        status: 'active', // Backend keeps status as 'active' until expiration
        cancelledAt: '2024-06-01T00:00:00Z',
        cancellationReason: 'Customer request',
      });
      const mockSubscription = createMockSubscriptionStatus({
        subscriptions: [subscription],
        activeSubscription: subscription,
      });
      const mockContextValue = createMockContextValue(mockSubscription);

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue);

      const { result } = renderHook(() => useSubscription());

      const returnedSub = result.current.subscriptions[0];
      expect(returnedSub.status).toBe('active');
      expect(returnedSub.cancelledAt).toBe('2024-06-01T00:00:00Z');
      expect(returnedSub.cancellationReason).toBe('Customer request');
    });
  });

  describe('Edge cases', () => {
    it('should handle undefined amount (treated as free)', () => {
      const subscription = createSubscription({
        amount: undefined,
      });
      const mockSubscription = createMockSubscriptionStatus({
        subscriptions: [subscription],
        activeSubscription: subscription,
        hasPaidSubscription: false,
      });
      const mockContextValue = createMockContextValue(mockSubscription);

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue);

      const { result } = renderHook(() => useSubscription());

      expect(result.current.subscriptions[0].amount).toBeUndefined();
      expect(result.current.hasPaidSubscription).toBe(false);
    });

    it('should handle zero amount (treated as free)', () => {
      const subscription = createSubscription({
        amount: 0,
      });
      const mockSubscription = createMockSubscriptionStatus({
        subscriptions: [subscription],
        activeSubscription: subscription,
        hasPaidSubscription: false,
      });
      const mockContextValue = createMockContextValue(mockSubscription);

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue);

      const { result } = renderHook(() => useSubscription());

      expect(result.current.subscriptions[0].amount).toBe(0);
      expect(result.current.hasPaidSubscription).toBe(false);
    });

    it('should handle very large subscription amounts', () => {
      const subscription = createSubscription({
        amount: 999999999,
      });
      const mockSubscription = createMockSubscriptionStatus({
        subscriptions: [subscription],
        activeSubscription: subscription,
        hasPaidSubscription: true,
        activePaidSubscription: subscription,
      });
      const mockContextValue = createMockContextValue(mockSubscription);

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue);

      const { result } = renderHook(() => useSubscription());

      expect(result.current.subscriptions[0].amount).toBe(999999999);
      expect(result.current.hasPaidSubscription).toBe(true);
    });

    it('should handle negative amount (edge case)', () => {
      const subscription = createSubscription({
        amount: -100,
      });
      const mockSubscription = createMockSubscriptionStatus({
        subscriptions: [subscription],
        activeSubscription: subscription,
        hasPaidSubscription: false, // Negative is not considered paid
      });
      const mockContextValue = createMockContextValue(mockSubscription);

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue);

      const { result } = renderHook(() => useSubscription());

      expect(result.current.subscriptions[0].amount).toBe(-100);
      expect(result.current.hasPaidSubscription).toBe(false);
    });
  });
});

