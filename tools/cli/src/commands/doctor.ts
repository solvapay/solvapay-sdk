import { runDoctorInDirectory } from '@solvapay/init'
import type { DoctorCommandOptions } from '@solvapay/init'

export type { DoctorCommandOptions } from '@solvapay/init'

export const runDoctorCommand = async (options: DoctorCommandOptions = {}): Promise<void> => {
  const report = await runDoctorInDirectory({ cwd: process.cwd(), options })
  if (!report.ok) {
    process.exitCode = 1
  }
}
