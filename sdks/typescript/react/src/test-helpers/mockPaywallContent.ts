import type { PaywallStructuredContent } from '@solvapay/server'

type ShortMessageOptional<T> = T extends unknown
  ? Omit<T, 'shortMessage'> & { shortMessage?: string }
  : never

const DEFAULT_SHORT_MESSAGE: Record<PaywallStructuredContent['kind'], string> = {
  payment_required: 'Payment required',
  activation_required: 'Activation required',
}

export function mockPaywallContent(
  input: ShortMessageOptional<PaywallStructuredContent>,
): PaywallStructuredContent {
  return { shortMessage: DEFAULT_SHORT_MESSAGE[input.kind], ...input } as PaywallStructuredContent
}
