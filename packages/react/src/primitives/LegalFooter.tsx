'use client'

/**
 * LegalFooter primitive.
 *
 * Renders a `Terms · Privacy · Provided by SolvaPay` strip pointing at
 * SolvaPay's own legal pages. Mirrors the hosted-checkout
 * `<LegalFooter>` (`solvapay-frontend/src/components/shared/LegalFooter.tsx`)
 * but Chakra-free so it can ship inside `<PaymentForm>` / `<TopupForm>`
 * default trees and the MCP shell footer.
 *
 * Merchant terms/privacy URLs are *not* rendered here — those continue
 * to be woven into the mandate sentence by `<MandateText>`.
 */

import React, { forwardRef } from 'react'
import { Slot } from './slot'
import { useCopy } from '../hooks/useCopy'

const SOLVAPAY_TERMS_URL = 'https://solvapay.com/legal/terms'
const SOLVAPAY_PRIVACY_URL = 'https://solvapay.com/legal/privacy'
const SOLVAPAY_WEBSITE_URL = 'https://solvapay.com'

export type LegalFooterProps = {
  /**
   * Attribution line below the Terms · Privacy row.
   * - `'provided'` (default) — `Provided by SolvaPay` link to solvapay.com
   * - `'powered'` — `Powered by SolvaPay` link to solvapay.com
   * - `false` — no attribution line
   */
  attribution?: 'provided' | 'powered' | false
  termsUrl?: string
  privacyUrl?: string
  asChild?: boolean
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> & {
    children?: React.ReactNode
  }

export const LegalFooter = forwardRef<HTMLDivElement, LegalFooterProps>(
  function LegalFooter(
    {
      attribution = 'provided',
      termsUrl = SOLVAPAY_TERMS_URL,
      privacyUrl = SOLVAPAY_PRIVACY_URL,
      asChild,
      children,
      ...rest
    },
    forwardedRef,
  ) {
    const copy = useCopy()
    const attributionLabel =
      attribution === 'provided'
        ? copy.legalFooter.providedBy
        : attribution === 'powered'
          ? copy.legalFooter.poweredBy
          : null

    const Comp = asChild ? Slot : 'div'
    return (
      <Comp ref={forwardedRef} data-solvapay-legal-footer="" {...rest}>
        {children ?? (
          <>
            <div data-solvapay-legal-footer-links="">
              <a
                data-solvapay-legal-footer-link=""
                href={termsUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {copy.legalFooter.terms}
              </a>
              <span aria-hidden="true"> · </span>
              <a
                data-solvapay-legal-footer-link=""
                href={privacyUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {copy.legalFooter.privacy}
              </a>
            </div>
            {attributionLabel ? (
              <a
                data-solvapay-legal-footer-attribution=""
                href={SOLVAPAY_WEBSITE_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                {attributionLabel}
              </a>
            ) : null}
          </>
        )}
      </Comp>
    )
  },
)
