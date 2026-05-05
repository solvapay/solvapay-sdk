import React from 'react'
import { SparklesIcon } from './icons/SparklesIcon'
import { ScenarioType } from '../types'

interface PaywallProps {
  onUnlock: () => void
  currentScenario?: ScenarioType
}

export const Paywall: React.FC<PaywallProps> = ({
  onUnlock,
  currentScenario = ScenarioType.SUBSCRIPTION,
}) => {
  const isTopUpScenario = currentScenario === ScenarioType.TOPUP
  const isDayPassScenario = currentScenario === ScenarioType.DAYPASS

  return (
    <div className="px-4 py-4">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-slate-100 border border-slate-200/60 flex items-center justify-center">
              <SparklesIcon className="h-4 w-4 text-slate-700" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900 leading-tight">
                {isTopUpScenario
                  ? 'Out of credits'
                  : isDayPassScenario
                    ? 'Free use exceeded'
                    : 'Free limit reached'}
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                {isTopUpScenario
                  ? 'Top up to keep chatting'
                  : isDayPassScenario
                    ? 'Get a day pass to continue'
                    : 'Upgrade for unlimited access'}
              </p>
            </div>
          </div>

          <div className="hidden lg:flex items-center space-x-6 text-xs text-slate-500">
            {isTopUpScenario ? (
              <>
                <div className="flex items-center space-x-1.5">
                  <div className="w-1.5 h-1.5 bg-blue-400 rounded-full"></div>
                  <span>$2 for 100 credits</span>
                </div>
                <div className="flex items-center space-x-1.5">
                  <div className="w-1.5 h-1.5 bg-green-400 rounded-full"></div>
                  <span>Instant top-up</span>
                </div>
              </>
            ) : isDayPassScenario ? (
              <>
                <div className="flex items-center space-x-1.5">
                  <div className="w-1.5 h-1.5 bg-purple-400 rounded-full"></div>
                  <span>$5 for 24 hours</span>
                </div>
                <div className="flex items-center space-x-1.5">
                  <div className="w-1.5 h-1.5 bg-green-400 rounded-full"></div>
                  <span>Unlimited messages</span>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center space-x-1.5">
                  <div className="w-1.5 h-1.5 bg-green-400 rounded-full"></div>
                  <span>Unlimited messages</span>
                </div>
                <div className="flex items-center space-x-1.5">
                  <div className="w-1.5 h-1.5 bg-blue-400 rounded-full"></div>
                  <span>Priority support</span>
                </div>
              </>
            )}
          </div>

          <button
            onClick={onUnlock}
            className="px-4 py-2.5 text-sm font-medium text-white bg-slate-900 rounded-full hover:bg-slate-800 transition-colors group flex items-center space-x-2"
          >
            <span>
              {isTopUpScenario ? 'Add Credits' : isDayPassScenario ? 'Get Day Pass' : 'Upgrade'}
            </span>
            <svg
              className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-0.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M13 7l5 5m0 0l-5 5m5-5H6"
              />
            </svg>
          </button>
        </div>

        <div className="lg:hidden flex items-center justify-center space-x-6 mt-3 pt-3 border-t border-slate-200/60">
          <div className="flex items-center space-x-6 text-xs text-slate-500">
            {isTopUpScenario ? (
              <>
                <div className="flex items-center space-x-1.5">
                  <div className="w-1.5 h-1.5 bg-blue-400 rounded-full"></div>
                  <span>$2 for 100 credits</span>
                </div>
                <div className="flex items-center space-x-1.5">
                  <div className="w-1.5 h-1.5 bg-green-400 rounded-full"></div>
                  <span>Instant top-up</span>
                </div>
              </>
            ) : isDayPassScenario ? (
              <>
                <div className="flex items-center space-x-1.5">
                  <div className="w-1.5 h-1.5 bg-purple-400 rounded-full"></div>
                  <span>$5 for 24 hours</span>
                </div>
                <div className="flex items-center space-x-1.5">
                  <div className="w-1.5 h-1.5 bg-green-400 rounded-full"></div>
                  <span>Unlimited messages</span>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center space-x-1.5">
                  <div className="w-1.5 h-1.5 bg-green-400 rounded-full"></div>
                  <span>Unlimited messages</span>
                </div>
                <div className="flex items-center space-x-1.5">
                  <div className="w-1.5 h-1.5 bg-blue-400 rounded-full"></div>
                  <span>Priority support</span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
