/**
 * `from-scratch` mode — copy the language template (TS: `_base/` + overlay;
 * others: `templates/mcp/<language>/`), substitute placeholders, pin SDK
 * versions, install, and run `solvapay init`.
 */

import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  detectPackageManager,
  resolveCliApiBaseUrl,
  resolveLatestVersions,
  runInitInDirectory,
} from '@solvapay/init'
import type { InitCommandOptions, ScaffoldLanguage } from '@solvapay/init'
import {
  applyDevPathDeps,
  installLanguageDependencies,
  namePlaceholders,
  patchManifest,
} from '../../languages'
import {
  applyOverlay,
  assertTargetDirAbsent,
  BASE_TEMPLATE_DIR,
  MCP_SHARED_SCRIPTS_DIR,
  copyDir,
  deriveServerName,
  FROM_SCRATCH_OVERLAY_DIR,
  gitInit,
  mcpLanguageTemplateDir,
  PLACEHOLDERS,
  pascalize,
  printConnectionSnippets,
  writeBootstrapEnv,
} from './scaffold'

export type FromScratchInput = {
  target: string
  projectName: string
  toolName: string
  language: ScaffoldLanguage
  goModule?: string
  options: InitCommandOptions
  productRef?: string
  skipInstall?: boolean
  skipInit?: boolean
  /**
   * When true, seed `SOLVAPAY_API_BASE_URL=https://api-dev.solvapay.com`
   * into the scaffolded `.env`. Also rewrites train-language manifests to
   * monorepo path deps when this CLI is running inside solvapay-sdk.
   */
  dev?: boolean
}

const DEFAULT_HTTP_ORIGIN: Record<ScaffoldLanguage, string> = {
  ts: 'http://localhost:8787',
  python: 'http://localhost:3030',
  ruby: 'http://localhost:3030',
  go: 'http://localhost:3030',
  rust: 'http://localhost:3030',
}

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

export async function findSolvapaySdkRoot(fromDir: string): Promise<string | undefined> {
  let dir = fromDir
  while (true) {
    if (await fileExists(join(dir, 'contract', 'manifest', 'repo-paths.yaml'))) {
      if (await fileExists(join(dir, 'sdks', 'python'))) return dir
    }
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

const DEV_PATHS = (
  language: ScaffoldLanguage,
  sdkRoot: string,
): Record<string, string> | undefined => {
  // Absolute paths so `--dev` still resolves after the scaffold is moved.
  const abs = (parts: string[]): string =>
    join(sdkRoot, ...parts)
      .split('\\')
      .join('/')
  switch (language) {
    case 'ts':
      // Every path is mapped under `tsPackages` / `sdks.wasm` in
      // contract/manifest/repo-paths.yaml. `link:`/`file:` deps ignore
      // semver, so the template's version floors never come up here.
      return {
        '@solvapay/mcp': abs(['sdks', 'typescript', 'mcp']),
        '@solvapay/server': abs(['sdks', 'typescript', 'server']),
        '@solvapay/react': abs(['sdks', 'typescript', 'react']),
        '@solvapay/core': abs(['sdks', 'typescript', 'core']),
        '@solvapay/server-wasm': abs(['sdks', 'wasm']),
      }
    case 'python':
      return {
        solvapay: abs(['sdks', 'python']),
        'solvapay-mcp': abs(['sdks', 'python-mcp']),
      }
    case 'ruby':
      return {
        solvapay: abs(['sdks', 'ruby']),
        'solvapay-mcp': abs(['sdks', 'ruby-mcp']),
      }
    case 'go':
      return { 'github.com/solvapay/solvapay-sdk/sdks/go': abs(['sdks', 'go']) }
    case 'rust':
      return {
        solvapay: abs(['sdks', 'rust']),
        'solvapay-mcp': abs(['sdks', 'rust-mcp']),
      }
    default:
      return undefined
  }
}

export async function runFromScratch(input: FromScratchInput): Promise<void> {
  const {
    target,
    projectName,
    toolName,
    language,
    goModule,
    options,
    productRef,
    skipInstall,
    skipInit,
    dev,
  } = input

  await assertTargetDirAbsent(target)

  const names = namePlaceholders({ projectName, toolName, goModule })
  const publicBaseUrl = DEFAULT_HTTP_ORIGIN[language]
  const substitutions = new Map<string, string>([
    [PLACEHOLDERS.WORKER_NAME, projectName],
    [PLACEHOLDERS.RESOURCE_URI_SLUG, projectName],
    [PLACEHOLDERS.SERVER_NAME, deriveServerName(projectName)],
    [PLACEHOLDERS.PRODUCT_REF, productRef ?? PLACEHOLDERS.PRODUCT_REF],
    [PLACEHOLDERS.PUBLIC_BASE_URL, publicBaseUrl],
    [PLACEHOLDERS.TOOL_NAME_PASCAL, pascalize(toolName)],
    // Snake_case MCP identifier on every row, including ts (F5). The old ts
    // exception emitted a camelCase MCP name that violated the snake_case
    // naming guardrail; `snakeCase()` normalizes camel or snake input alike.
    [PLACEHOLDERS.TOOL_NAME, names.toolNameSnake],
    ['__PYTHON_PACKAGE__', names.pythonPackage],
    ['__RUBY_MODULE__', names.rubyModule],
    ['__GO_MODULE__', names.goModule],
    ['__CRATE_NAME__', names.crateName],
    ['__BIN_NAME__', names.binName],
    ['__TOOL_NAME_SNAKE__', names.toolNameSnake],
  ])

  process.stdout.write(`📁 Scaffolding ${projectName} (${language}, from-scratch) at ${target}\n`)

  if (language === 'ts') {
    await copyDir(BASE_TEMPLATE_DIR, target, { substitutions })
    // File stem tracks the snake_case MCP identifier so the generated
    // `import … from './__TOOL_NAME__'` (also substituted to snake_case)
    // resolves regardless of whether the user passed camel or snake.
    const renameMap = new Map<string, string>([
      [`src/tools/_placeholder.ts`, `src/tools/${names.toolNameSnake}.ts`],
    ])
    await applyOverlay(FROM_SCRATCH_OVERLAY_DIR, target, { substitutions, renameMap })
  } else {
    await copyDir(mcpLanguageTemplateDir(language), target, { substitutions })
  }
  await copyDir(MCP_SHARED_SCRIPTS_DIR, join(target, 'scripts'), { substitutions })

  const apiBaseUrl = resolveCliApiBaseUrl(options)
  await writeBootstrapEnv(target, productRef ?? PLACEHOLDERS.PRODUCT_REF, {
    apiBaseUrl,
    publicBaseUrl,
  })

  const packageManager = language === 'ts' ? await detectPackageManager(target) : 'npm'

  // Registry version resolution is for the published lane only. Under `--dev`
  // the manifest is rewritten to checkout paths just below, so resolving and
  // pinning registry versions here is wasted work — and for an unpublished
  // package (e.g. @solvapay/server-wasm) it would pin a version that installs
  // nowhere. Skipping it keeps the dev lane fully offline.
  if (!dev) {
    process.stdout.write(`🔄 Resolving latest SolvaPay versions for ${language}…\n`)
    const versionMap = await resolveLatestVersions(language, undefined, {
      failOnNotPublished: true,
    })
    await patchManifest(language, target, versionMap)
  }

  if (dev) {
    const sdkRoot = await findSolvapaySdkRoot(mcpLanguageTemplateDir(language))
    const paths = sdkRoot ? DEV_PATHS(language, sdkRoot) : undefined
    if (paths) {
      const { readFile, writeFile } = await import('node:fs/promises')
      const manifestName =
        language === 'ts'
          ? 'package.json'
          : language === 'python'
            ? 'pyproject.toml'
            : language === 'ruby'
              ? 'Gemfile'
              : language === 'go'
                ? 'go.mod'
                : 'Cargo.toml'
      const manifestPath = join(target, manifestName)
      const raw = await readFile(manifestPath, 'utf8')
      // npm has no `link:` protocol; use `file:` there. pnpm/yarn symlink a
      // `link:` dep against the checkout, so edits in the SDK show up without
      // a reinstall — the point of the dev lane.
      const protocol = packageManager === 'npm' ? 'file' : 'link'
      await writeFile(manifestPath, applyDevPathDeps(language, raw, paths, protocol), 'utf8')
      process.stdout.write('🧪 --dev: using monorepo path dependencies\n')
    }
  }
  if (skipInstall) {
    process.stdout.write('⏭  Skipping dependency install (--skip-install)\n')
  } else {
    process.stdout.write(`📦 Installing dependencies…\n`)
    const installResult = await installLanguageDependencies(
      language,
      target,
      packageManager,
      message => {
        process.stdout.write(`   ${message}\n`)
      },
    )
    if (!installResult.ok) {
      process.stdout.write(
        `⚠️  ${installResult.command} failed (${installResult.warning ?? 'unknown error'}). ` +
          `Install dependencies manually inside ${target} before running.\n`,
      )
    } else {
      process.stdout.write('✅ Dependencies installed\n')
    }
  }

  process.stdout.write('\n')
  if (skipInit) {
    process.stdout.write('⏭  Skipping `solvapay init` (--skip-init)\n')
  } else {
    await runInitInDirectory({
      cwd: target,
      options: { ...options, apiBaseUrl },
      skipSdkInstall: true,
      language,
    })
  }

  await gitInit(target)

  process.stdout.write(`\n🎉 Done. Next steps:\n`)
  process.stdout.write(`   cd ${projectName}\n`)
  if (skipInstall) {
    const hint =
      language === 'ts'
        ? `${packageManager} install`
        : language === 'python'
          ? 'uv sync'
          : language === 'ruby'
            ? 'bundle install'
            : language === 'go'
              ? 'go mod tidy'
              : 'cargo fetch'
    process.stdout.write(`   ${hint}   # --skip-install was set\n`)
  }
  if (skipInit) {
    process.stdout.write(
      `   npx -y solvapay@latest init   # --skip-init was set; run to wire up auth + product\n`,
    )
  }
  const runHint =
    language === 'ts'
      ? `${packageManager === 'npm' ? 'npm run' : packageManager} dev`
      : language === 'python'
        ? 'uv run python main.py --mode http'
        : language === 'ruby'
          ? 'bundle exec ruby main.rb --mode http'
          : language === 'go'
            ? 'go run . --mode http'
            : 'cargo run -- --mode http'
  process.stdout.write(`   ${runHint}\n`)
  if (language === 'ts') {
    process.stdout.write(`   # Edit src/tools/${toolName}.ts to replace the placeholder.\n`)
  } else {
    process.stdout.write(
      `   # Edit the placeholder ${names.toolNameSnake} tool before going live.\n`,
    )
  }

  printConnectionSnippets({ projectName, workerUrl: publicBaseUrl })
}
