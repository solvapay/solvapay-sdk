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
  LIFETIME = 'lifetime',
}
