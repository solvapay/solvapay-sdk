import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { resolveMcpClassNames } from '../../../types'
import type { SuccessMeta } from '../../shared'
import { SuccessStep } from '../SuccessStep'

const cx = resolveMcpClassNames(undefined)
const creditNote = 'Usage past your 10 included requests is paid from credits. Your balance is 0.'

function recurringMeta(note: string | null): SuccessMeta {
  return {
    branch: 'recurring',
    plan: { name: 'Pro', reference: 'pln_pro' },
    includedUnits: 10,
    meterName: 'requests',
    chargedTodayMinor: 1900,
    currency: 'USD',
    nextRenewalLabel: null,
    creditNote: note,
  }
}

describe('SuccessStep', () => {
  it('says the subscription is live and shows the credit note', () => {
    render(<SuccessStep meta={recurringMeta(creditNote)} cx={cx} />)

    expect(screen.getByRole('heading', { name: 'Pro active' })).toBeTruthy()
    expect(screen.getByText('Subscription is live.')).toBeTruthy()
    expect(screen.getByText(creditNote)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('hides the credit note when the wallet is funded', () => {
    render(<SuccessStep meta={recurringMeta(null)} cx={cx} />)

    expect(screen.getByText('Subscription is live.')).toBeTruthy()
    expect(screen.queryByText(/paid from credits/)).toBeNull()
  })
})
