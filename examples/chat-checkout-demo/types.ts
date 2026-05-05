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

export type TopUpAmount = 100 | 200

export interface TopUpSelection {
  amount: TopUpAmount
  autoTopUpEnabled: boolean
}
