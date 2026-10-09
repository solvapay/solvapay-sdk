import { describe, expect, it } from 'vitest'
import {
  anthropicError,
  badRequest,
  customerNotLinked,
  decisionError,
  topupRequired,
} from '../agent-layer/errors'

describe('Anthropic-shaped errors', () => {
  it('builds the Anthropic error body with the request id', async () => {
    const response = anthropicError(400, 'Nope.', 'req-1')
    expect(response.status).toBe(400)
    expect(response.headers.get('content-type')).toMatch(/application\/json/)
    expect(await response.json()).toEqual({
      type: 'error',
      error: { type: 'invalid_request_error', message: 'Nope.' },
      request_id: 'req-1',
    })
  })

  it('maps ask to 402 and deny to 422, with the reason text as the message', async () => {
    const ask = decisionError('ask', 'Stopped: raise the budget.', 'req-1')
    const deny = decisionError('deny', 'Blocked.', 'req-2')
    expect(ask.status).toBe(402)
    expect(deny.status).toBe(422)
    expect((await ask.json()).error.message).toBe('Stopped: raise the budget.')
    expect((await deny.json()).error).toEqual({
      type: 'invalid_request_error',
      message: 'Blocked.',
    })
  })

  it('gives the S4 refusals and a bad body the same shape', async () => {
    expect(customerNotLinked('r').status).toBe(402)
    expect((await customerNotLinked('r').json()).error.message).toMatch(/Connect it in SolvaPay/)
    const topup = topupRequired(
      'The balance of 0.01 USD is below the 0.09 USD one call may cost.',
      'r',
    )
    expect(topup.status).toBe(402)
    expect((await topup.json()).error.message).toMatch(/^The balance of 0\.01 USD/)
    expect((await badRequest('The request body is not valid JSON.', 'r').json()).type).toBe('error')
  })
})
