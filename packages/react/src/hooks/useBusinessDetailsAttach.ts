import { useCallback, useEffect, useRef, useState } from 'react'
import {
  validateBusinessDetails,
  type BusinessDetailsInput,
  type TaxBreakdown,
} from '@solvapay/core'
import { mapBusinessFieldErrors } from '../components/businessCheckoutParts'

export const defaultBusinessDetails: BusinessDetailsInput = { isBusiness: false }

export type AttachBusinessDetailsFn = (params: {
  paymentIntentId: string
  customerRef?: string
  isBusiness: boolean
  businessName?: string
  country?: string
  taxId?: string
  taxIdType?: import('@solvapay/core').TaxIdType
}) => Promise<{ taxBreakdown: TaxBreakdown }>

export interface UseBusinessDetailsAttachOptions {
  processorPaymentId: string | null | undefined
  attachBusinessDetails?: AttachBusinessDetailsFn
  customerRef?: string
  onTaxChange?: (breakdown: TaxBreakdown) => void
  /** Called after a successful attach so PaymentForm can refresh Stripe Elements. */
  refreshElements?: () => Promise<void> | void
}

export interface UseBusinessDetailsAttachReturn {
  businessDetails: BusinessDetailsInput
  setBusinessDetails: (patch: Partial<BusinessDetailsInput>) => void
  fieldErrors: Partial<Record<keyof BusinessDetailsInput, string>>
  taxBreakdown: TaxBreakdown | null
  businessDetailsAttached: boolean
  businessDetailsAttaching: boolean
  businessDetailsError: string | null
  requiresBusinessAttach: boolean
  runAttach: (input: BusinessDetailsInput) => Promise<boolean>
}

export function useBusinessDetailsAttach(
  options: UseBusinessDetailsAttachOptions,
): UseBusinessDetailsAttachReturn {
  const { processorPaymentId, attachBusinessDetails, customerRef, onTaxChange, refreshElements } =
    options

  const [businessDetails, setBusinessDetailsState] =
    useState<BusinessDetailsInput>(defaultBusinessDetails)
  const [taxBreakdown, setTaxBreakdown] = useState<TaxBreakdown | null>(null)
  const [businessDetailsAttached, setBusinessDetailsAttached] = useState(false)
  const [businessDetailsAttaching, setBusinessDetailsAttaching] = useState(false)
  const [businessDetailsError, setBusinessDetailsError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<keyof BusinessDetailsInput, string>>
  >({})

  const attachRequestIdRef = useRef(0)

  const setBusinessDetails = useCallback((patch: Partial<BusinessDetailsInput>) => {
    setBusinessDetailsState(prev => {
      const next = { ...prev, ...patch }
      if (patch.isBusiness === false) {
        return { isBusiness: false }
      }
      return next
    })
    setBusinessDetailsAttached(false)
    setBusinessDetailsError(null)
  }, [])

  const runAttach = useCallback(
    async (input: BusinessDetailsInput): Promise<boolean> => {
      if (!processorPaymentId || !attachBusinessDetails) {
        return !attachBusinessDetails
      }

      const validation = validateBusinessDetails(input)
      if (!validation.success) {
        setFieldErrors(mapBusinessFieldErrors(input))
        return false
      }

      setFieldErrors({})
      const requestId = ++attachRequestIdRef.current
      setBusinessDetailsAttaching(true)

      try {
        const result = await attachBusinessDetails({
          paymentIntentId: processorPaymentId,
          ...(customerRef ? { customerRef } : {}),
          ...validation.data,
        })
        if (requestId !== attachRequestIdRef.current) return false
        setTaxBreakdown(result.taxBreakdown)
        setBusinessDetailsAttached(true)
        setBusinessDetailsError(null)
        onTaxChange?.(result.taxBreakdown)
        if (refreshElements) {
          await refreshElements()
        }
        return true
      } catch (err) {
        if (requestId !== attachRequestIdRef.current) return false
        const msg = err instanceof Error ? err.message : String(err)
        setBusinessDetailsAttached(false)
        setBusinessDetailsError(msg)
        return false
      } finally {
        if (requestId === attachRequestIdRef.current) {
          setBusinessDetailsAttaching(false)
        }
      }
    },
    [processorPaymentId, attachBusinessDetails, customerRef, onTaxChange, refreshElements],
  )

  useEffect(() => {
    if (!processorPaymentId || !attachBusinessDetails) return

    const validation = validateBusinessDetails(businessDetails)
    if (!validation.success) {
      setFieldErrors(mapBusinessFieldErrors(businessDetails))
      setBusinessDetailsAttached(false)
      return
    }

    setFieldErrors({})
    const timer = setTimeout(() => {
      void runAttach(businessDetails)
    }, 300)

    return () => clearTimeout(timer)
  }, [businessDetails, processorPaymentId, attachBusinessDetails, runAttach])

  const requiresBusinessAttach = !!attachBusinessDetails

  return {
    businessDetails,
    setBusinessDetails,
    fieldErrors,
    taxBreakdown,
    businessDetailsAttached,
    businessDetailsAttaching,
    businessDetailsError,
    requiresBusinessAttach,
    runAttach,
  }
}
