export function chargeAmountMinor(
  taxBreakdown: { total: number } | null | undefined,
  amountMinor: number,
): number {
  return taxBreakdown?.total ?? amountMinor
}
