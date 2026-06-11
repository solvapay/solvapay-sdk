import { detectPackageManager, runInitInDirectory } from '@solvapay/init'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { ProjectType } from '../registry'
import type { ParsedTypeArgs, RunOptions } from '../../args'
import { toInitOptions } from '../../args'
import {
  assertTargetDirAbsent,
  copyDir,
  gitInit,
  installProjectDependencies,
} from '../mcp/scaffold'

const NEXT_AUTH0_TEMPLATE_DIR = join(fileURLToPath(new URL('../../../templates/next-auth0', import.meta.url)))

const parseNextAuth0Args = (): ParsedTypeArgs => ({
  noOpenapi: false,
  help: false,
})

export const nextAuth0ProjectType: ProjectType = {
  id: 'next-auth0',
  label: 'Next.js + Auth0 starter',
  summary: 'Next.js starter with SolvaPay Auth0 middleware + provider wiring',
  parseArgs: parseNextAuth0Args,
  run,
}

async function run(opts: RunOptions): Promise<void> {
  const { target, projectName, common } = opts
  const options = toInitOptions(common)

  await assertTargetDirAbsent(target)
  process.stdout.write(`📁 Scaffolding ${projectName} (next-auth0) at ${target}\n`)

  const substitutions = new Map<string, string>([['__PROJECT_NAME__', projectName]])
  await copyDir(NEXT_AUTH0_TEMPLATE_DIR, target, { substitutions })

  const packageManager = await detectPackageManager(target)
  if (common.skipInstall) {
    process.stdout.write('⏭  Skipping dependency install (--skip-install)\n')
  } else {
    process.stdout.write(`📦 Installing dependencies with ${packageManager}...\n`)
    const installResult = await installProjectDependencies(packageManager, target)
    if (!installResult.ok) {
      process.stdout.write(
        `⚠️  ${installResult.command} failed (${installResult.warning ?? 'unknown error'}).\n`,
      )
    } else {
      process.stdout.write('✅ Dependencies installed\n')
    }
  }

  if (common.skipInit) {
    process.stdout.write('⏭  Skipping `solvapay init` (--skip-init)\n')
  } else {
    await runInitInDirectory({ cwd: target, options, skipSdkInstall: true })
  }

  await gitInit(target)

  process.stdout.write('\n🎉 Done. Next steps:\n')
  process.stdout.write(`   cd ${projectName}\n`)
  if (common.skipInstall) {
    process.stdout.write(`   ${packageManager} install\n`)
  }
  if (common.skipInit) {
    process.stdout.write('   npx -y solvapay@latest init\n')
  }
  process.stdout.write(`   ${packageManager === 'npm' ? 'npm run' : packageManager} dev\n`)
}
