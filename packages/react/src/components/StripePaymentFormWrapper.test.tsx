import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { StripePaymentFormWrapper } from './StripePaymentFormWrapper'
import { enCopy } from '../i18n/en'

const confirmCardPayment = vi.fn()
const getElement = vi.fn()
const cardOnChangeRef: { current?: (event: {
  complete: boolean
  error?: { message: string }
}) => void } = {}

vi.mock('@stripe/react-stripe-js', () => ({
  CardElement: ({
    onChange,
  }: {
    onChange?: (event: { complete: boolean; error?: { message: string } }) => void
  }) => {
    cardOnChangeRef.current = onChange
    return React.createElement('section', { 'data-testid': 'card-element' })
  },
  useStripe: () => ({ confirmCardPayment }),
  useElements: () => ({ getElement }),
}))

vi.mock('../hooks/useCustomer', () => ({
  useCustomer: () => ({ email: 'user@example.com', name: 'User Example' }),
}))

vi.mock('../hooks/useCopy', () => ({
  useCopy: () => enCopy,
}))

describe('StripePaymentFormWrapper', () => {
  beforeEach(() => {
    confirmCardPayment.mockReset()
    getElement.mockReset()
    getElement.mockReturnValue({ __tag: 'card' })
    cardOnChangeRef.current = undefined
  })

  it('renders the Card Element when Stripe is ready', () => {
    render(<StripePaymentFormWrapper clientSecret="cs_test" />)
    expect(screen.getByTestId('card-element')).toBeInTheDocument()
  })

  it('keeps submit disabled until the card input is complete', async () => {
    render(<StripePaymentFormWrapper clientSecret="cs_test" />)
    const button = screen.getByRole('button', { name: enCopy.cta.payNow })
    expect(button).toBeDisabled()

    cardOnChangeRef.current?.({ complete: true })
    await waitFor(() => expect(button).not.toBeDisabled())
  })

  it('calls confirmCardPayment on submit and invokes onSuccess', async () => {
    const paymentIntent = { id: 'pi_ok', status: 'succeeded' }
    confirmCardPayment.mockResolvedValue({ paymentIntent })
    const onSuccess = vi.fn()

    render(
      <StripePaymentFormWrapper clientSecret="cs_test" onSuccess={onSuccess} submitButtonText="Pay" />,
    )

    cardOnChangeRef.current?.({ complete: true })
    await act(async () => {
      await Promise.resolve()
    })
    const button = await screen.findByRole('button', { name: 'Pay' })
    await waitFor(() => expect(button).not.toBeDisabled())

    await act(async () => {
      fireEvent.click(button)
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(confirmCardPayment).toHaveBeenCalledWith(
        'cs_test',
        expect.objectContaining({
          payment_method: expect.objectContaining({
            card: { __tag: 'card' },
            billing_details: { email: 'user@example.com', name: 'User Example' },
          }),
        }),
      )
    })
    expect(onSuccess).toHaveBeenCalledWith(paymentIntent)
  })

  it('surfaces Stripe errors and calls onError', async () => {
    confirmCardPayment.mockResolvedValue({ error: { message: 'card declined' } })
    const onError = vi.fn()

    render(<StripePaymentFormWrapper clientSecret="cs_test" onError={onError} />)

    cardOnChangeRef.current?.({ complete: true })
    const button = await screen.findByRole('button', { name: enCopy.cta.payNow })
    await waitFor(() => expect(button).not.toBeDisabled())

    fireEvent.click(button)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('card declined')
    })
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'card declined' }))
  })

  it('reports a missing card element via onError', async () => {
    getElement.mockReturnValue(undefined)
    const onError = vi.fn()

    render(<StripePaymentFormWrapper clientSecret="cs_test" onError={onError} />)

    cardOnChangeRef.current?.({ complete: true })
    const button = await screen.findByRole('button', { name: enCopy.cta.payNow })
    await waitFor(() => expect(button).not.toBeDisabled())

    fireEvent.click(button)

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: enCopy.errors.cardElementMissing }),
      )
    })
  })
})
