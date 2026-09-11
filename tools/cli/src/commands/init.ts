import { runInitInDirectory } from '@solvapay/init'
import type { InitCommandOptions } from '@solvapay/init'

export type { InitCommandOptions } from '@solvapay/init'

export const runInitCommand = async (options: InitCommandOptions = {}): Promise<void> => {
  await runInitInDirectory({ cwd: process.cwd(), options })
}
