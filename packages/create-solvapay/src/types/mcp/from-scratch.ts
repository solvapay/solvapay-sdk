/**
 * `from-scratch` mode — copy the mode-agnostic `_base/` tree, layer the
 * `from-scratch/` overlay (placeholder paid tool), substitute the user's
 * camelCase tool name into both filename and source, and write a
 * minimal `.env` ready for `solvapay init` to populate.
 */

import { detectPackageManager, runInitInDirectory } from '@solvapay/init'
import type { InitCommandOptions } from '@solvapay/init'
import {
  applyOverlay,
  assertTargetDirAbsent,
  BASE_TEMPLATE_DIR,
  copyDir,
  deriveServerName,
  FROM_SCRATCH_OVERLAY_DIR,
  gitInit,
  PLACEHOLDERS,
  pascalize,
  installProjectDependencies,
  printConnectionSnippets,
  writeBootstrapEnv,
} from './scaffold'

export type FromScratchInput = {
  target: string
  projectName: string
  toolName: string
  options: InitCommandOptions
  productRef?: string
  skipInstall?: boolean
  skipInit?: boolean
}

export async function runFromScratch(input: FromScratchInput): Promise<void> {
  const { target, projectName, toolName, options, productRef, skipInstall, skipInit } = input

  await assertTargetDirAbsent(target)

  const substitutions = new Map<string, string>([
    [PLACEHOLDERS.WORKER_NAME, projectName],
    [PLACEHOLDERS.RESOURCE_URI_SLUG, projectName],
    [PLACEHOLDERS.SERVER_NAME, deriveServerName(projectName)],
    [PLACEHOLDERS.PRODUCT_REF, productRef ?? PLACEHOLDERS.PRODUCT_REF],
    [PLACEHOLDERS.PUBLIC_BASE_URL, 'http://localhost:8787'],
    [PLACEHOLDERS.TOOL_NAME_PASCAL, pascalize(toolName)],
    [PLACEHOLDERS.TOOL_NAME, toolName],
  ])

  process.stdout.write(`📁 Scaffolding ${projectName} (from-scratch) at ${target}\n`)
  await copyDir(BASE_TEMPLATE_DIR, target, { substitutions })

  // Rename the literal `_placeholder.ts` overlay file to `<toolName>.ts`
  // when it lands in the target. The `__TOOL_NAME__` placeholder inside
  // the file body is substituted via the standard pass.
  const renameMap = new Map<string, string>([
    [`src/tools/_placeholder.ts`, `src/tools/${toolName}.ts`],
  ])
  await applyOverlay(FROM_SCRATCH_OVERLAY_DIR, target, { substitutions, renameMap })

  await writeBootstrapEnv(target, productRef ?? PLACEHOLDERS.PRODUCT_REF)

  const packageManager = await detectPackageManager(target)
  if (skipInstall) {
    process.stdout.write('⏭  Skipping dependency install (--skip-install)\n')
  } else {
    process.stdout.write(`📦 Installing dependencies with ${packageManager}...\n`)
    const installResult = await installProjectDependencies(packageManager, target, message => {
      process.stdout.write(`   ${message}\n`)
    })
    if (!installResult.ok) {
      process.stdout.write(
        `⚠️  ${installResult.command} failed (${installResult.warning ?? 'unknown error'}). ` +
          `Run \`${packageManager} install\` manually inside ${target} before deploying.\n`,
      )
    } else {
      process.stdout.write('✅ Dependencies installed\n')
    }
  }

  process.stdout.write('\n')
  if (skipInit) {
    process.stdout.write('⏭  Skipping `solvapay init` (--skip-init)\n')
  } else {
    await runInitInDirectory({ cwd: target, options, skipSdkInstall: true })
  }

  await gitInit(target)

  process.stdout.write(`\n🎉 Done. Next steps:\n`)
  process.stdout.write(`   cd ${projectName}\n`)
  if (skipInstall) {
    process.stdout.write(
      `   ${packageManager} install   # --skip-install was set; install before running dev\n`,
    )
  }
  if (skipInit) {
    process.stdout.write(`   npx solvapay init   # --skip-init was set; run to wire up auth + product\n`)
  }
  process.stdout.write(
    `   ${packageManager === 'npm' ? 'npm run' : packageManager} dev   # widget watch + wrangler dev on http://localhost:8787\n`,
  )
  process.stdout.write(`   # Edit src/tools/${toolName}.ts to replace the placeholder.\n`)

  printConnectionSnippets({ projectName })
}
