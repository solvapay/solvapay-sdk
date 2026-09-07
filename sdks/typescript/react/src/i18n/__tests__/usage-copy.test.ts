import { describe, expect, it } from 'vitest'
import { enCopy } from '../en'
import { interpolate } from '../interpolate'

describe('usage.* captions', () => {
  it('keeps the reusable meter labels unchanged', () => {
    expect(enCopy.usage.usedLabel).toBe('{used} / {total} {unit}')
    expect(enCopy.usage.remainingLabel).toBe('{remaining} {unit} remaining')
    expect(enCopy.usage.resetsInLabel).toBe('Resets in {days} days')
    expect(enCopy.usage.unlimitedLabel).toBe('Unlimited')
  })

  it('adds v3 FactBand and meter captions', () => {
    expect(enCopy.usage.remainingEyebrow).toBe('Remaining')
    expect(enCopy.usage.renewsEyebrow).toBe('Renews')
    expect(enCopy.usage.resetsEyebrow).toBe('Resets')
    expect(enCopy.usage.creditsEyebrow).toBe('Credits')
    expect(enCopy.usage.usedEyebrow).toBe('Used')
    expect(enCopy.usage.afterFirstCall).toBe('After your first call')
    expect(enCopy.usage.inDays).toBe('In {days} days.')
    expect(enCopy.usage.notKnownYet).toBe('Not known yet')
    expect(enCopy.usage.creditsNotUsed).toBe('Not used')
    expect(enCopy.usage.creditsUntouched).toBe('Balance is untouched.')
    expect(enCopy.usage.creditsDoNotSpend).toBe('This plan does not spend your balance.')
    expect(enCopy.account.creditActivityCaption).toMatch(/account-wide/)
    expect(enCopy.account.chargesEyebrow).toBe('Charges for this product')
    expect(enCopy.usage.rateConfirmedAtCheckout).toBe('Rate confirmed at checkout')
    expect(enCopy.usage.ofTotalThisPeriod).toBe('Of {total} this period.')
    expect(enCopy.usage.remainingCalls).toBe('{remaining} {unit}')
    expect(enCopy.usage.remainingOfTotal).toBe('{remaining} of {total} {unit}')
    expect(enCopy.usage.usedOfTotalPercent).toBe('{used} of {total} {unit} used, {percent}%.')
    expect(enCopy.usage.warningThresholdHint).toBe(
      'A warning shows at 80%, and calls stop at 100%.',
    )
    expect(enCopy.usage.lastCallHint).toBe(
      'One remaining {unit} is the difference between working and blocked.',
    )
    expect(enCopy.usage.fromCreditsPerCall).toBe('from {credits} credits per call')
    expect(enCopy.usage.creditsPerCall).toBe('{credits} credits per call')
  })

  it('adds accent-pill copy for D, F and I', () => {
    expect(enCopy.usage.callsFailing).toBe('Calls failing')
    expect(enCopy.usage.overAllowance).toBe('Over the allowance')
    expect(enCopy.usage.limitReached).toBe('{plan} limit reached')
    expect(interpolate(enCopy.usage.limitReached, { plan: 'Free' })).toBe('Free limit reached')
  })

  it('adds the E upgrade prompt and See plans link', () => {
    expect(enCopy.account.seePlans).toBe('See plans →')
    expect(enCopy.account.upgradePaygCaption).toBe(
      'Pay as you go starts without payment and uses your credits.',
    )
    expect(
      interpolate(enCopy.account.needMoreAllowance, {
        total: '3',
        unit: 'calls',
        interval: 'month',
      }),
    ).toBe('Need more than 3 calls a month?')
  })

  it('adds A/F ladder copy', () => {
    expect(enCopy.account.noPlanStatus).toBe('No plan')
    expect(enCopy.account.choosePlanCaption).toBe(
      'Choose a plan to start using it. Calls fail until one is active.',
    )
    expect(enCopy.account.plansEyebrow).toBe('Plans')
    expect(enCopy.account.carryOnEyebrow).toBe('Carry on with')
    expect(enCopy.account.activatePlanButton).toBe('Activate')
    expect(enCopy.account.switchPlanButton).toBe('Switch')
    expect(enCopy.account.activatingPlanButton).toBe('Activating…')
    expect(interpolate(enCopy.account.usedUpTitle, { plan: 'free', unit: 'calls' })).toBe(
      'Your free calls are used up',
    )
    expect(
      interpolate(enCopy.account.antiTrapCredits, {
        credits: '599,800',
        plan: 'Free',
      }),
    ).toBe(
      'You have 599,800 credits. Free does not spend them, so adding funds will not restore calls.',
    )
  })

  it('adds H/I/J forced-state copy', () => {
    expect(enCopy.account.notStartedStatus).toBe('Not started')
    expect(enCopy.account.startFreePlan).toBe('Start free plan')
    expect(enCopy.account.noCardCaption).toBe('No card, no charge. You can change plan later.')
    expect(
      interpolate(enCopy.account.readyToClaim, {
        total: '3',
        unit: 'calls',
        interval: 'month',
      }),
    ).toBe('3 free calls a month, ready to claim')
    expect(enCopy.account.stillWorking).toBe('Calls are still working.')
    expect(enCopy.account.seeHigherLimit).toBe('See plans with a higher limit →')
    expect(
      interpolate(enCopy.account.usedOfAllowance, {
        used: '11,240',
        total: '10,000',
        unit: 'calls',
      }),
    ).toBe('11,240 of 10,000 calls')
    expect(interpolate(enCopy.account.activeUntil, { date: 'Oct 12' })).toBe('Active until Oct 12')
    expect(
      interpolate(enCopy.account.cancelledPlanLine, {
        plan: 'Starter',
        date: 'Sep 4, 2026',
      }),
    ).toBe('Starter · cancelled Sep 4, 2026')
    expect(interpolate(enCopy.account.daysLeftTitle, { days: '36' })).toBe(
      '36 days left on this plan',
    )
    expect(interpolate(enCopy.account.reactivatePlan, { plan: 'Starter' })).toBe(
      'Reactivate Starter',
    )
  })
})
