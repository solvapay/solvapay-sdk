import { runInitInDirectory } from '@solvapay/cli-core'
import type { InitCommandOptions } from '@solvapay/cli-core'

export type { InitCommandOptions } from '@solvapay/cli-core'

export const runInitCommand = async (options: InitCommandOptions = {}): Promise<void> => {
  await runInitInDirectory({ cwd: process.cwd(), options })
}
