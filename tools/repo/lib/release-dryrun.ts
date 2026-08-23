/**
 * Release dry-run gate (Step 55-c).
 *
 * Folds the pre-publish stable-version assert into a checker that also
 * requires every `workspace:*` / `workspace:^` / `workspace:~` production
 * dep of a publishable package to resolve inside the publish batch, and
 * requires all six publish workflows to expose a dry-run default.
 */

import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import {
  INTERNAL_PACKAGE_IDS,
  REPO_PATHS,
  SDK_SURFACES,
  TOOL_PACKAGE_IDS,
  TS_PACKAGE_IDS,
  internalPackageRel,
  joinRel,
  toolPackageRel,
  tsPackageRel,
} from '../../shared/paths.js'

export const PUBLISH_WORKFLOW_FILES = [
  'publish.yml',
  'publish-preview.yml',
  'publish-rust.yml',
  'publish-go.yml',
  'publish-ruby.yml',
  'publish-python.yml',
] as const

export const PRERELEASE_RE = /-(?:preview|canary|rc|alpha|beta|next|snapshot)\b/i

const WORKSPACE_PROTOCOL_RE = /^workspace:/

function workspacePackageRels(): string[] {
  const rels = [
    ...TS_PACKAGE_IDS.map(tsPackageRel),
    ...TOOL_PACKAGE_IDS.map(toolPackageRel),
    ...INTERNAL_PACKAGE_IDS.map(internalPackageRel),
  ]
  for (const surface of SDK_SURFACES) {
    if (surface === 'typescript') {
      continue
    }
    rels.push(REPO_PATHS.sdks[surface])
  }
  return rels
}

export type ReleaseDryrunIssueKind =
  | 'prerelease-version'
  | 'unresolved-workspace-dep'
  | 'missing-dry-run-default'

export type ReleaseDryrunIssue = {
  kind: ReleaseDryrunIssueKind
  message: string
  packageName?: string
  version?: string
  dependencyName?: string
  workflowFile?: string
}

export type WorkspacePackage = {
  name: string
  version: string
  private?: boolean
  path?: string
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

export type PublishWorkflowDoc = {
  fileName: string
  yaml: string
}

export type ReleaseDryrunInput = {
  packages: readonly WorkspacePackage[]
  changesetIgnore: readonly string[]
  workflows: readonly PublishWorkflowDoc[]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isIgnoredPackage(
  pkg: Pick<WorkspacePackage, 'name' | 'private'>,
  changesetIgnore: readonly string[],
): boolean {
  if (pkg.private === true) return true
  for (const pattern of changesetIgnore) {
    if (pattern.endsWith('/*')) {
      const scope = pattern.slice(0, -2)
      if (pkg.name.startsWith(`${scope}/`)) return true
    } else if (pkg.name === pattern) {
      return true
    }
  }
  return false
}

export function isPrereleaseVersion(version: string): boolean {
  return PRERELEASE_RE.test(version)
}

export function isPublishablePackage(
  pkg: Pick<WorkspacePackage, 'name' | 'private'>,
  changesetIgnore: readonly string[],
): boolean {
  return Boolean(pkg.name) && !isIgnoredPackage(pkg, changesetIgnore)
}

function productionWorkspaceDeps(pkg: WorkspacePackage): Array<{ name: string; spec: string }> {
  const out: Array<{ name: string; spec: string }> = []
  const groups = [pkg.dependencies, pkg.peerDependencies, pkg.optionalDependencies]
  for (const group of groups) {
    if (!group) continue
    for (const [name, spec] of Object.entries(group)) {
      if (WORKSPACE_PROTOCOL_RE.test(spec)) out.push({ name, spec })
    }
  }
  return out
}

export function workflowHasDryRunDefault(yamlText: string): boolean {
  const raw: unknown = parseYaml(yamlText)
  if (!isPlainObject(raw)) return false
  const onValue = raw.on
  if (!isPlainObject(onValue)) return false
  const dispatch = onValue.workflow_dispatch
  if (!isPlainObject(dispatch)) return false
  const inputs = dispatch.inputs
  if (!isPlainObject(inputs)) return false

  const dryRun = inputs.dry_run
  if (isPlainObject(dryRun) && dryRun.default === true) return true

  for (const [key, value] of Object.entries(inputs)) {
    if (!key.startsWith('publish_to_')) continue
    if (isPlainObject(value) && value.default === false) return true
  }
  return false
}

export function checkReleaseDryrun(input: ReleaseDryrunInput): ReleaseDryrunIssue[] {
  const issues: ReleaseDryrunIssue[] = []
  const publishable = input.packages.filter(pkg => isPublishablePackage(pkg, input.changesetIgnore))
  const batchNames = new Set(publishable.map(pkg => pkg.name))

  for (const pkg of publishable) {
    if (isPrereleaseVersion(pkg.version)) {
      issues.push({
        kind: 'prerelease-version',
        packageName: pkg.name,
        version: pkg.version,
        message: `${pkg.name}@${pkg.version} is a pre-release; pnpm publish would pin siblings to a non-@latest tag`,
      })
    }
    for (const dep of productionWorkspaceDeps(pkg)) {
      if (batchNames.has(dep.name)) continue
      issues.push({
        kind: 'unresolved-workspace-dep',
        packageName: pkg.name,
        dependencyName: dep.name,
        message: `${pkg.name} depends on ${dep.name} via ${dep.spec}, which is not in the publish batch`,
      })
    }
  }

  for (const workflow of input.workflows) {
    if (workflowHasDryRunDefault(workflow.yaml)) continue
    issues.push({
      kind: 'missing-dry-run-default',
      workflowFile: workflow.fileName,
      message: `${workflow.fileName} has no dry-run default (dry_run: true, or publish_to_* default false)`,
    })
  }

  return issues
}

export function formatReleaseDryrunReport(issues: readonly ReleaseDryrunIssue[]): string {
  if (issues.length === 0) return 'release-dryrun: OK'
  const lines = issues.map(i => {
    const who = i.packageName ?? i.workflowFile ?? i.dependencyName ?? '?'
    return `  [${i.kind}] ${who}: ${i.message}`
  })
  return `release-dryrun: ${issues.length} issue(s)\n${lines.join('\n')}`
}

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf8'))
}

function listPackageJsonPaths(repoRoot: string): string[] {
  const out: string[] = []
  for (const rel of workspacePackageRels()) {
    const pkgPath = joinRel(repoRoot, rel, 'package.json')
    try {
      if (statSync(pkgPath).isFile()) out.push(pkgPath)
    } catch {
      // No package.json in this directory — skip.
    }
  }
  return out
}

function parseWorkspacePackage(pkgPath: string, raw: unknown): WorkspacePackage | undefined {
  if (!isPlainObject(raw) || typeof raw.name !== 'string' || typeof raw.version !== 'string') {
    return undefined
  }
  return {
    name: raw.name,
    version: raw.version,
    private: raw.private === true ? true : undefined,
    path: pkgPath,
    dependencies: isPlainObject(raw.dependencies)
      ? (raw.dependencies as Record<string, string>)
      : undefined,
    peerDependencies: isPlainObject(raw.peerDependencies)
      ? (raw.peerDependencies as Record<string, string>)
      : undefined,
    optionalDependencies: isPlainObject(raw.optionalDependencies)
      ? (raw.optionalDependencies as Record<string, string>)
      : undefined,
  }
}

export function loadChangesetIgnore(repoRoot: string): string[] {
  const raw = readJson(path.join(repoRoot, '.changeset', 'config.json'))
  if (!isPlainObject(raw) || !Array.isArray(raw.ignore)) return []
  return raw.ignore.filter((entry): entry is string => typeof entry === 'string')
}

export function loadWorkspacePackages(repoRoot: string): WorkspacePackage[] {
  const packages: WorkspacePackage[] = []
  for (const pkgPath of listPackageJsonPaths(repoRoot)) {
    const parsed = parseWorkspacePackage(pkgPath, readJson(pkgPath))
    if (parsed) packages.push(parsed)
  }
  return packages
}

export function loadPublishWorkflows(repoRoot: string): PublishWorkflowDoc[] {
  return PUBLISH_WORKFLOW_FILES.map(fileName => ({
    fileName,
    yaml: readFileSync(path.join(repoRoot, '.github', 'workflows', fileName), 'utf8'),
  }))
}

export function runReleaseDryrunCheck(repoRoot: string): ReleaseDryrunIssue[] {
  return checkReleaseDryrun({
    packages: loadWorkspacePackages(repoRoot),
    changesetIgnore: loadChangesetIgnore(repoRoot),
    workflows: loadPublishWorkflows(repoRoot),
  })
}

export function formatStableVersionFailure(issues: readonly ReleaseDryrunIssue[]): string {
  const offenders = issues.filter(i => i.kind === 'prerelease-version')
  const lines = [
    'Workspace contains pre-release versions on a stable branch:',
    ...offenders.map(off => {
      const rel = off.packageName ?? '?'
      return `  - ${rel}@${off.version}`
    }),
    '',
    'pnpm publish would substitute these strings into every dependent',
    "package's `dependencies` / `peerDependencies`, pinning stable",
    'releases to a pre-release tag. Reset these to the last published',
    'stable version (or add a changeset to bump them) before merging.',
  ]
  return lines.join('\n')
}
