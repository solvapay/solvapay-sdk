'use client'

/**
 * Shared business-details field and tax-summary compound parts.
 *
 * Both `TopupForm` and `PaymentForm` stamp their own `data-solvapay-*`
 * attribute prefix while sharing identical markup and behavior.
 */

import React, { forwardRef } from 'react'
import { Slot } from '../primitives/slot'
import { composeEventHandlers } from '../primitives/composeEventHandlers'
import {
  BUSINESS_COUNTRY_OPTIONS,
  SUPPORTED_BUSINESS_COUNTRIES,
  validateBusinessDetails,
  getTaxIdFieldLabel,
  getTaxIdExample,
  getTaxIdHelperText,
  type BusinessDetailsInput,
  type SupportedBusinessCountry,
  type TaxBreakdown,
} from '@solvapay/core'
import { useLocale } from '../hooks/useCopy'
import { formatPrice } from '../utils/format'

export function mapBusinessFieldErrors(
  input: BusinessDetailsInput,
): Partial<Record<keyof BusinessDetailsInput, string>> {
  const result = validateBusinessDetails(input)
  if (result.success) return {}
  const errors: Partial<Record<keyof BusinessDetailsInput, string>> = {}
  for (const issue of result.error.issues) {
    const key = issue.path[0]
    if (typeof key === 'string' && !errors[key as keyof BusinessDetailsInput]) {
      errors[key as keyof BusinessDetailsInput] = issue.message
    }
  }
  return errors
}

export type BusinessDetailsContextSlice = {
  businessDetails: BusinessDetailsInput
  setBusinessDetails: (patch: Partial<BusinessDetailsInput>) => void
  fieldErrors: Partial<Record<keyof BusinessDetailsInput, string>>
}

export type TaxSummaryContextSlice = {
  taxBreakdown: TaxBreakdown | null
  businessDetailsAttaching: boolean
  baseAmountMinor: number
  currency: string
  isBusiness: boolean
}

type AttrPrefix = 'topup-form' | 'payment-form'

function attr(prefix: AttrPrefix, suffix: string): string {
  return `data-solvapay-${prefix}-${suffix}`
}

function isSupportedBusinessCountry(value: string): value is SupportedBusinessCountry {
  return (SUPPORTED_BUSINESS_COUNTRIES as readonly string[]).includes(value)
}

function resolveTaxIdLabel(country: string): string {
  if (country && isSupportedBusinessCountry(country)) {
    return getTaxIdFieldLabel(country)
  }
  return 'Tax ID'
}

function resolveTaxIdPlaceholder(country: string): string {
  if (country && isSupportedBusinessCountry(country)) {
    return getTaxIdExample(country)
  }
  return 'Enter tax ID'
}

function resolveTaxIdHelperText(country: string): string {
  if (country && isSupportedBusinessCountry(country)) {
    return getTaxIdHelperText(country)
  }
  return ''
}

export function formatVatSummaryLabel(breakdown: {
  treatment: TaxBreakdown['treatment']
  taxRate: number
  inclusive: boolean
}): string {
  if (breakdown.treatment === 'reverse_charge') {
    return 'VAT (reverse charge)'
  }

  if (breakdown.taxRate > 0) {
    const ratePercent =
      breakdown.taxRate <= 1 ? Math.round(breakdown.taxRate * 100) : breakdown.taxRate
    return breakdown.inclusive ? `VAT (${ratePercent}%, incl.)` : `VAT (${ratePercent}%)`
  }

  return 'VAT'
}

function shouldShowTaxRow(treatment: TaxBreakdown['treatment'] | null, taxRate: number): boolean {
  if (treatment === 'not_collecting') return false
  if (treatment === 'reverse_charge') return true
  return taxRate > 0
}

type SlotSpreadProps = Record<string, unknown>

export function createBusinessDetailsParts(
  useCtx: (part: string) => BusinessDetailsContextSlice,
  prefix: AttrPrefix,
) {
  type RootProps = React.HTMLAttributes<HTMLElement> & {
    asChild?: boolean
    children?: React.ReactNode
  }

  const Root = forwardRef<HTMLElement, RootProps>(function BusinessDetailsRoot(
    { asChild, children, ...rest },
    forwardedRef,
  ) {
    useCtx('BusinessDetails')
    const Comp = asChild ? Slot : 'section'
    return (
      <Comp ref={forwardedRef} {...{ [attr(prefix, 'business-details')]: '' }} {...rest}>
        {children}
      </Comp>
    )
  })

  type ToggleProps = React.InputHTMLAttributes<HTMLInputElement> & { asChild?: boolean }

  const Toggle = forwardRef<HTMLInputElement, ToggleProps>(function BusinessDetailsToggle(
    { asChild, onChange, ...rest },
    forwardedRef,
  ) {
    const ctx = useCtx('BusinessDetails.Toggle')
    const commonProps = {
      [attr(prefix, 'business-details-toggle')]: '',
      type: 'checkbox',
      checked: ctx.businessDetails.isBusiness,
      onChange: composeEventHandlers(onChange, (e: React.ChangeEvent<HTMLInputElement>) => {
        ctx.setBusinessDetails({ isBusiness: e.target.checked })
      }),
      ...rest,
    }

    if (asChild) {
      return <Slot ref={forwardedRef} {...(commonProps as SlotSpreadProps)} />
    }

    return <input ref={forwardedRef} {...commonProps} />
  })

  type FieldProps = React.InputHTMLAttributes<HTMLInputElement> & { asChild?: boolean }

  const BusinessName = forwardRef<HTMLInputElement, FieldProps>(
    function BusinessDetailsBusinessName({ asChild, onChange, ...rest }, forwardedRef) {
      const ctx = useCtx('BusinessDetails.BusinessName')
      if (!ctx.businessDetails.isBusiness) return null

      const commonProps = {
        [attr(prefix, 'business-details-name')]: '',
        type: 'text',
        value: ctx.businessDetails.businessName ?? '',
        'aria-invalid': ctx.fieldErrors.businessName ? true : undefined,
        onChange: composeEventHandlers(onChange, (e: React.ChangeEvent<HTMLInputElement>) => {
          ctx.setBusinessDetails({ businessName: e.target.value })
        }),
        ...rest,
      }

      if (asChild) {
        return <Slot ref={forwardedRef} {...(commonProps as SlotSpreadProps)} />
      }

      return <input ref={forwardedRef} {...commonProps} />
    },
  )

  type CountryProps = React.SelectHTMLAttributes<HTMLSelectElement> & { asChild?: boolean }

  const Country = forwardRef<HTMLSelectElement, CountryProps>(function BusinessDetailsCountry(
    { asChild, onChange, children, ...rest },
    forwardedRef,
  ) {
    const ctx = useCtx('BusinessDetails.Country')
    if (!ctx.businessDetails.isBusiness) return null

    const commonProps = {
      [attr(prefix, 'business-details-country')]: '',
      value: ctx.businessDetails.country ?? '',
      'aria-invalid': ctx.fieldErrors.country ? true : undefined,
      onChange: composeEventHandlers(onChange, (e: React.ChangeEvent<HTMLSelectElement>) => {
        ctx.setBusinessDetails({ country: e.target.value })
      }),
      ...rest,
    }

    const defaultOptions = (
      <>
        <option value="">Select country</option>
        {BUSINESS_COUNTRY_OPTIONS.map(({ value, label }) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </>
    )

    if (asChild) {
      return (
        <Slot ref={forwardedRef} {...(commonProps as SlotSpreadProps)}>
          {children ?? defaultOptions}
        </Slot>
      )
    }

    return (
      <select ref={forwardedRef} {...commonProps}>
        {children ?? defaultOptions}
      </select>
    )
  })

  const TaxId = forwardRef<HTMLInputElement, FieldProps>(function BusinessDetailsTaxId(
    { asChild, onChange, ...rest },
    forwardedRef,
  ) {
    const ctx = useCtx('BusinessDetails.TaxId')
    if (!ctx.businessDetails.isBusiness) return null

    const commonProps = {
      [attr(prefix, 'business-details-tax-id')]: '',
      type: 'text',
      value: ctx.businessDetails.taxId ?? '',
      'aria-invalid': ctx.fieldErrors.taxId ? true : undefined,
      onChange: composeEventHandlers(onChange, (e: React.ChangeEvent<HTMLInputElement>) => {
        ctx.setBusinessDetails({ taxId: e.target.value })
      }),
      ...rest,
    }

    if (asChild) {
      return <Slot ref={forwardedRef} {...(commonProps as SlotSpreadProps)} />
    }

    return <input ref={forwardedRef} {...commonProps} />
  })

  const Fields = forwardRef<HTMLElement, RootProps>(function BusinessDetailsFields(
    { asChild, children, ...rest },
    forwardedRef,
  ) {
    const ctx = useCtx('BusinessDetails.Fields')
    const country = ctx.businessDetails.country ?? ''
    const taxIdLabel = resolveTaxIdLabel(country)
    const taxIdPlaceholder = resolveTaxIdPlaceholder(country)
    const taxIdHelperText = resolveTaxIdHelperText(country)

    const content = (
      <>
        <label className="solvapay-checkout-business-toggle">
          <Toggle />
          I&apos;m purchasing as a business
        </label>
        {ctx.businessDetails.isBusiness ? (
          <fieldset className="solvapay-business-fields">
            <label className="solvapay-business-field">
              <span className="solvapay-business-field-label">Business name</span>
              <BusinessName placeholder="Acme GmbH" />
            </label>
            <label className="solvapay-business-field">
              <span className="solvapay-business-field-label">Country</span>
              <Country />
            </label>
            <label className="solvapay-business-field">
              <span className="solvapay-business-field-label">{taxIdLabel}</span>
              <TaxId placeholder={taxIdPlaceholder} />
              {taxIdHelperText ? (
                <p className="solvapay-business-field-hint">{taxIdHelperText}</p>
              ) : null}
            </label>
          </fieldset>
        ) : null}
        {children}
      </>
    )

    if (asChild) {
      return (
        <Slot ref={forwardedRef} {...(rest as SlotSpreadProps)}>
          {content}
        </Slot>
      )
    }

    return (
      <section ref={forwardedRef} {...{ [attr(prefix, 'business-details-fields')]: '' }} {...rest}>
        {content}
      </section>
    )
  })

  return {
    Root,
    Toggle,
    BusinessName,
    Country,
    TaxId,
    Fields,
  } as const
}

function useSummaryAmounts(useCtx: (part: string) => TaxSummaryContextSlice, part: string) {
  const ctx = useCtx(part)
  const locale = useLocale()
  const currency = (ctx.taxBreakdown?.currency ?? ctx.currency ?? 'usd').toLowerCase()

  const subtotalMinor = ctx.taxBreakdown?.subtotal ?? ctx.baseAmountMinor
  const taxMinor = ctx.taxBreakdown?.taxAmount ?? 0
  const totalMinor = ctx.taxBreakdown?.total ?? ctx.baseAmountMinor

  return {
    subtotalFormatted: formatPrice(subtotalMinor, currency, { locale }),
    taxFormatted: formatPrice(taxMinor, currency, { locale }),
    totalFormatted: formatPrice(totalMinor, currency, { locale }),
    taxRate: ctx.taxBreakdown?.taxRate ?? 0,
    treatment: ctx.taxBreakdown?.treatment ?? null,
    inclusive: ctx.taxBreakdown?.inclusive ?? false,
    attaching: ctx.businessDetailsAttaching,
  }
}

export function createTaxSummaryParts(
  useCtx: (part: string) => TaxSummaryContextSlice,
  prefix: AttrPrefix,
) {
  type RootProps = React.HTMLAttributes<HTMLElement> & {
    asChild?: boolean
    children?: React.ReactNode
  }

  const Root = forwardRef<HTMLElement, RootProps>(function TaxSummaryRoot(
    { asChild, children, ...rest },
    forwardedRef,
  ) {
    const ctx = useCtx('Summary')
    if (!ctx.isBusiness) return null
    const Comp = asChild ? Slot : 'section'
    return (
      <Comp ref={forwardedRef} {...{ [attr(prefix, 'summary')]: '' }} {...rest}>
        {children}
      </Comp>
    )
  })

  type LeafProps = React.HTMLAttributes<HTMLSpanElement> & { asChild?: boolean }

  const Subtotal = forwardRef<HTMLSpanElement, LeafProps>(function TaxSummarySubtotal(
    { asChild, children, ...rest },
    forwardedRef,
  ) {
    const ctx = useCtx('Summary.Subtotal')
    const { subtotalFormatted } = useSummaryAmounts(useCtx, 'Summary.Subtotal')
    if (!ctx.isBusiness) return null
    const Comp = asChild ? Slot : 'span'
    return (
      <Comp ref={forwardedRef} {...{ [attr(prefix, 'summary-subtotal')]: '' }} {...rest}>
        {children ?? subtotalFormatted}
      </Comp>
    )
  })

  const Tax = forwardRef<HTMLSpanElement, LeafProps>(function TaxSummaryTax(
    { asChild, children, ...rest },
    forwardedRef,
  ) {
    const ctx = useCtx('Summary.Tax')
    const { taxFormatted, taxRate, treatment, inclusive } = useSummaryAmounts(useCtx, 'Summary.Tax')
    if (!ctx.isBusiness) return null
    const Comp = asChild ? Slot : 'span'
    const defaultLabel = formatVatSummaryLabel({
      treatment: treatment ?? 'standard',
      taxRate,
      inclusive,
    })
    return (
      <Comp ref={forwardedRef} {...{ [attr(prefix, 'summary-tax')]: '' }} {...rest}>
        {children ?? (
          <>
            <span>{defaultLabel}</span>{' '}
            <span {...{ [attr(prefix, 'summary-tax-amount')]: '' }}>{taxFormatted}</span>
          </>
        )}
      </Comp>
    )
  })

  const Total = forwardRef<HTMLSpanElement, LeafProps>(function TaxSummaryTotal(
    { asChild, children, ...rest },
    forwardedRef,
  ) {
    const ctx = useCtx('Summary.Total')
    const { totalFormatted } = useSummaryAmounts(useCtx, 'Summary.Total')
    if (!ctx.isBusiness) return null
    const Comp = asChild ? Slot : 'span'
    return (
      <Comp ref={forwardedRef} {...{ [attr(prefix, 'summary-total')]: '' }} {...rest}>
        {children ?? totalFormatted}
      </Comp>
    )
  })

  const TaxNote = forwardRef<
    HTMLParagraphElement,
    React.HTMLAttributes<HTMLParagraphElement> & { asChild?: boolean }
  >(function TaxSummaryTaxNote({ asChild, children, ...rest }, forwardedRef) {
    const ctx = useCtx('Summary.TaxNote')
    const { treatment } = useSummaryAmounts(useCtx, 'Summary.TaxNote')
    if (!ctx.isBusiness) return null
    if (!treatment || treatment === 'standard') return null
    const Comp = asChild ? Slot : 'p'
    const defaultNote =
      treatment === 'reverse_charge'
        ? 'VAT reverse charge applies — you are responsible for reporting VAT in your jurisdiction.'
        : treatment === 'not_collecting'
          ? 'Tax is not collected on this purchase.'
          : null
    if (!defaultNote && !children) return null
    return (
      <Comp ref={forwardedRef} {...{ [attr(prefix, 'summary-tax-note')]: '' }} {...rest}>
        {children ?? defaultNote}
      </Comp>
    )
  })

  const Rows = forwardRef<HTMLElement, RootProps>(function TaxSummaryRows(
    { asChild, children, ...rest },
    forwardedRef,
  ) {
    const ctx = useCtx('Summary.Rows')
    const { taxRate, treatment, inclusive, taxFormatted } = useSummaryAmounts(useCtx, 'Summary.Rows')
    if (!ctx.isBusiness) return null
    const showTaxRow = shouldShowTaxRow(treatment, taxRate)
    const vatLabel = formatVatSummaryLabel({
      treatment: treatment ?? 'standard',
      taxRate,
      inclusive,
    })

    const content = (
      <dl className="solvapay-tax-summary-rows">
        <p className="solvapay-tax-summary-row">
          <dt>Subtotal</dt>
          <dd>
            <Subtotal />
          </dd>
        </p>
        {showTaxRow ? (
          <p className="solvapay-tax-summary-row">
            <dt>{vatLabel}</dt>
            <dd>
              <span {...{ [attr(prefix, 'summary-tax-amount')]: '' }}>{taxFormatted}</span>
            </dd>
          </p>
        ) : null}
        <p className="solvapay-tax-summary-row solvapay-tax-summary-row--total">
          <dt>Total</dt>
          <dd>
            <Total />
          </dd>
        </p>
        <TaxNote />
        {children}
      </dl>
    )

    if (asChild) {
      return (
        <Slot ref={forwardedRef} {...(rest as SlotSpreadProps)}>
          {content}
        </Slot>
      )
    }

    return (
      <section ref={forwardedRef} {...{ [attr(prefix, 'summary-rows')]: '' }} {...rest}>
        {content}
      </section>
    )
  })

  return {
    Root,
    Subtotal,
    Tax,
    Total,
    TaxNote,
    Rows,
  } as const
}
