export enum UserType {
  USER = 'user',
  BOT = 'bot',
}

export interface Message {
  id: number
  text: string
  sender: UserType
}

export enum ScenarioType {
  SUBSCRIPTION = 'subscription',
  TOPUP = 'topup',
  DAYPASS = 'daypass',
}

/**
 * A user's choice in the top-up flow. The selected pack is identified
 * by its plan reference — credit counts and prices come from the plan
 * data fetched from SolvaPay, not hardcoded constants.
 */
export interface TopUpSelection {
  planRef: string
  autoTopUpEnabled: boolean
}
