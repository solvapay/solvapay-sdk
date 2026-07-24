/**
 * Monorepo typecheck without `tsc -b --noEmit`.
 *
 * Composite project references require referenced packages to emit
 * declaration files, so the solution build with `--noEmit` fails with TS6310.
 * Instead we typecheck each publishable package with the same tsconfig.build.json
 * surface that tsup uses for DTS generation.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

type PackageTypecheck = {
  dir: string
  projects: string[]
}

/** Dependency order keeps logs readable; each project is checked independently. */
const PACKAGES: PackageTypecheck[] = [
  { dir: 'packages/core', projects: ['tsconfig.build.json'] },
  { dir: 'packages/auth', projects: ['tsconfig.build.json'] },
  { dir: 'packages/init', projects: ['tsconfig.build.json'] },
  { dir: 'packages/mcp-core', projects: ['tsconfig.build.json'] },
  { dir: 'packages/server', projects: ['tsconfig.build.json'] },
  { dir: 'packages/mcp', projects: ['tsconfig.build.json'] },
  { dir: 'packages/next', projects: ['tsconfig.build.json'] },
  {
    dir: 'packages/react',
    projects: ['tsconfig.build.json', '__tests__/tsconfig.types.json'],
  },
  { dir: 'packages/react-supabase', projects: ['tsconfig.build.json'] },
  { dir: 'packages/demo-services', projects: ['tsconfig.build.json'] },
  { dir: 'packages/cli', projects: ['tsconfig.build.json'] },
  { dir: 'packages/create-solvapay', projects: ['tsconfig.build.json'] },
]

function runTsc(projectPath: string): number {
  const result = spawnSync('pnpm', ['exec', 'tsc', '--noEmit', '-p', projectPath], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  })
  return result.status ?? 1
}

function main(): void {
  for (const pkg of PACKAGES) {
    for (const project of pkg.projects) {
      const projectPath = path.join(REPO_ROOT, pkg.dir, project)
      if (!existsSync(projectPath)) {
        console.error(`typecheck: missing project file ${projectPath}`)
        process.exit(1)
      }

      const label = project === 'tsconfig.build.json' ? pkg.dir : `${pkg.dir}/${project}`
      console.log(`\n> typecheck ${label}`)
      const status = runTsc(projectPath)
      if (status !== 0) {
        process.exit(status)
      }
    }
  }

  console.log('\n> typecheck all packages passed')
}

main()
