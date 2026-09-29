import { describe, expect, it } from 'vitest'
import {
  buildCardSetupReturnUrl,
  readCardSetupReturn,
  withoutCardSetupReturnParams,
} from './cardSetupReturn'

describe('cardSetupReturn', () => {
  it('tags the return url with the session and card id, keeping other params', () => {
    expect(
      buildCardSetupReturnUrl('https://app.example/billing?tab=credits#top', {
        sessionId: 'cs_sess_1',
        cardId: 'CRD_1',
      }),
    ).toBe(
      'https://app.example/billing?tab=credits&solvapay_card_setup_session=cs_sess_1&solvapay_card_setup_card=CRD_1#top',
    )
  })

  it('replaces previous tags instead of duplicating them', () => {
    expect(
      buildCardSetupReturnUrl(
        'https://app.example/?solvapay_card_setup_session=old&solvapay_card_setup_card=CRD_old',
        { sessionId: 'cs_new', cardId: 'CRD_new' },
      ),
    ).toBe('https://app.example/?solvapay_card_setup_session=cs_new&solvapay_card_setup_card=CRD_new')
  })

  it('reads the resume target only when both params are present', () => {
    expect(
      readCardSetupReturn('?solvapay_card_setup_session=cs_sess_1&solvapay_card_setup_card=CRD_1'),
    ).toStrictEqual({ sessionId: 'cs_sess_1', cardId: 'CRD_1' })
    expect(readCardSetupReturn('?solvapay_card_setup_session=cs_sess_1')).toBeUndefined()
    expect(readCardSetupReturn('?foo=bar')).toBeUndefined()
  })

  it('strips its own params and the rail return params, keeping the rest', () => {
    expect(
      withoutCardSetupReturnParams(
        'https://app.example/billing?tab=credits&solvapay_card_setup_session=cs&solvapay_card_setup_card=CRD&redirect_status=succeeded',
      ),
    ).toBe('https://app.example/billing?tab=credits')
  })
})
