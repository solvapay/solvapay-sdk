import { describe, expect, it } from 'vitest'
import {
  buildCardSetupReturnUrl,
  readCardSetupReturn,
  withoutCardSetupReturnParams,
} from './cardSetupReturn'

describe('cardSetupReturn', () => {
  it('tags the return url with the customer session only, keeping other params', () => {
    expect(
      buildCardSetupReturnUrl('https://app.example/billing?tab=credits#top', {
        sessionId: 'cs_sess_1',
      }),
    ).toBe('https://app.example/billing?tab=credits&solvapay_card_setup_session=cs_sess_1#top')
  })

  it('replaces a previous tag instead of duplicating it', () => {
    expect(
      buildCardSetupReturnUrl('https://app.example/?solvapay_card_setup_session=old', {
        sessionId: 'cs_new',
      }),
    ).toBe('https://app.example/?solvapay_card_setup_session=cs_new')
  })

  it('reads the resume target when the session param is present', () => {
    expect(readCardSetupReturn('?solvapay_card_setup_session=cs_sess_1')).toStrictEqual({
      sessionId: 'cs_sess_1',
    })
    expect(readCardSetupReturn('?solvapay_card_setup_session=')).toBeUndefined()
    expect(readCardSetupReturn('?foo=bar')).toBeUndefined()
  })

  it('strips its own param and the rail return params, keeping the rest', () => {
    expect(
      withoutCardSetupReturnParams(
        'https://app.example/billing?tab=credits&solvapay_card_setup_session=cs&redirect_status=succeeded&setup_intent=seti_1&setup_intent_client_secret=secret',
      ),
    ).toBe('https://app.example/billing?tab=credits')
  })
})
