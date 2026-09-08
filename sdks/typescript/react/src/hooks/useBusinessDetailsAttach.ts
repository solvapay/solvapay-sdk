import { useCallback, useEffect, useRef, useState } from 'react'
import {
  isTaxIdType,
  getCustomerAddressFieldErrors,
  isCustomerAddressComplete,
  validateBusinessDetails,
  type BusinessDetailsInput,
  type TaxBreakdown,
  type TaxIdType,
} from '@solvapay/core'
import { mapAttachFieldErrors, mapBusinessFieldErrors } from '../components/businessCheckoutParts'

export const defaultBusinessDetails: BusinessDetailsInput = { isBusiness: false }

type BusinessFieldErrors = Partial<Record<keyof BusinessDetailsInput, string>>

/**
 * The core binding declares this `unknown`, so narrow it once here. A
 * non-record answer is a broken binding contract, not a "no errors"
 * answer, so it throws rather than degrading to `{}`.
 */
function customerAddressFieldErrors(input: BusinessDetailsInput): BusinessFieldErrors {
  const errors = getCustomerAddressFieldErrors(input)
  if (errors === null || typeof errors !== 'object' || Array.isArray(errors)) {
    throw new TypeError(
      `getCustomerAddressFieldErrors returned ${typeof errors}, expected a field-error record`,
    )
  }
  const narrowed: Record<string, string> = {}
  for (const [key, value] of Object.entries(errors)) {
    if (typeof value === 'string') narrowed[key] = value
  }
  return narrowed
}

function taxIdTypeFromInput(value: unknown): TaxIdType | undefined {
  return typeof value === 'string' && isTaxIdType(value) ? value : undefined
}

export type AttachBusinessDetailsFn = (params: {
  paymentIntentId: string
  customerRef?: string
  isBusiness: boolean
  businessName?: string
  country?: string
  customerCountry?: string
  customerName?: string
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
        // Leaving business mode drops the business fields but keeps the
        // buyer's own address: they still bought from somewhere.
        return {
          isBusiness: false,
          ...(next.customerCountry && { customerCountry: next.customerCountry }),
          ...(next.customerState && { customerState: next.customerState }),
          ...(next.customerPostalCode && { customerPostalCode: next.customerPostalCode }),
          ...(next.customerName && { customerName: next.customerName }),
        }
      }
      if (patch.isBusiness === true && !next.country && next.customerCountry) {
        return { ...next, country: next.customerCountry }
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

      setFieldErrors({})
      const requestId = ++attachRequestIdRef.current
      setBusinessDetailsAttaching(true)

      try {
        const taxIdType = taxIdTypeFromInput(input.taxIdType)
        const result = await attachBusinessDetails({
          paymentIntentId: processorPaymentId,
          ...(customerRef ? { customerRef } : {}),
          isBusiness: input.isBusiness,
          ...(input.businessName !== undefined ? { businessName: input.businessName } : {}),
          ...(input.country !== undefined ? { country: input.country } : {}),
          ...(input.customerCountry !== undefined
            ? { customerCountry: input.customerCountry }
            : {}),
          ...(input.customerName !== undefined ? { customerName: input.customerName } : {}),
          ...(input.taxId !== undefined ? { taxId: input.taxId } : {}),
          ...(taxIdType !== undefined ? { taxIdType } : {}),
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
        setFieldErrors(mapAttachFieldErrors(err))
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

    // Auto-attach is a background tax lookup, so it waits for a payload the
    // backend can actually price. `runAttach` stays ungated: an explicit
    // submit must reach the server and surface its field errors.
    const validation = validateBusinessDetails(businessDetails)
    if (!validation.success || !isCustomerAddressComplete(businessDetails)) {
      const countrySelected = !!(
        businessDetails.customerCountry?.trim() ||
        (businessDetails.isBusiness && businessDetails.country?.trim())
      )
      setFieldErrors({
        ...mapBusinessFieldErrors(businessDetails),
        ...(countrySelected ? customerAddressFieldErrors(businessDetails) : {}),
      })
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
