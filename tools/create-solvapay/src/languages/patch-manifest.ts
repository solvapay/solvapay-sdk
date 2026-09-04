import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ScaffoldLanguage } from '@solvapay/init'

const pinPyproject = (raw: string, versions: Map<string, string>): string => {
  let out = raw
  for (const [name, version] of versions) {
    const pinned = `"${name}==${version}"`
    const alreadyPinned = new RegExp(`"${name}==[^"]+"`)
    if (alreadyPinned.test(out)) {
      out = out.replace(alreadyPinned, pinned)
      continue
    }
    out = out.replaceAll(`"${name}"`, pinned)
  }
  return out
}

const pinGemfile = (raw: string, versions: Map<string, string>): string => {
  let out = raw
  for (const [name, version] of versions) {
    const withVersion = new RegExp(`gem\\s+"${name}"\\s*,\\s*"[^"]+"`)
    const bare = new RegExp(`gem\\s+"${name}"(?!\\s*,)`)
    if (withVersion.test(out)) {
      out = out.replace(withVersion, `gem "${name}", "${version}"`)
    } else if (bare.test(out)) {
      out = out.replace(bare, `gem "${name}", "${version}"`)
    }
  }
  return out
}

const pinGoMod = (raw: string, versions: Map<string, string>): string => {
  let out = raw
  for (const [name, version] of versions) {
    const re = new RegExp(`${name.replace(/\//g, '\\/')}\\s+v?\\S+`)
    out = out.replace(re, `${name} ${version.startsWith('v') ? version : `v${version}`}`)
  }
  return out
}

const pinCargoToml = (raw: string, versions: Map<string, string>): string => {
  let out = raw
  for (const [name, version] of versions) {
    const quoted = new RegExp(`(^|\\n)(${name}\\s*=\\s*)"[^"]+"`, 'm')
    const table = new RegExp(`(^|\\n)(${name}\\s*=\\s*\\{[^}]*version\\s*=\\s*)"[^"]+"`, 'm')
    if (table.test(out)) {
      out = out.replace(table, `$1$2"${version}"`)
    } else if (quoted.test(out)) {
      out = out.replace(quoted, `$1$2"${version}"`)
    }
  }
  return out
}

export async function patchNpmPackageJson(
  target: string,
  versionMap: Map<string, string>,
): Promise<void> {
  const pkgPath = join(target, 'package.json')
  const raw = await readFile(pkgPath, 'utf8')
  const pkg = JSON.parse(raw) as { dependencies?: Record<string, string> } & Record<string, unknown>
  if (!pkg.dependencies || typeof pkg.dependencies !== 'object') return

  let changed = false
  for (const [name, version] of versionMap) {
    if (Object.prototype.hasOwnProperty.call(pkg.dependencies, name)) {
      if (pkg.dependencies[name] !== version) {
        pkg.dependencies[name] = version
        changed = true
      }
    }
  }
  if (!changed) return
  const trailingNewline = raw.endsWith('\n') ? '\n' : ''
  await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}${trailingNewline}`, 'utf8')
}

export function rewriteManifest(
  language: ScaffoldLanguage,
  raw: string,
  versions: Map<string, string>,
): string {
  switch (language) {
    case 'ts':
      return raw
    case 'python':
      return pinPyproject(raw, versions)
    case 'ruby':
      return pinGemfile(raw, versions)
    case 'go':
      return pinGoMod(raw, versions)
    case 'rust':
      return pinCargoToml(raw, versions)
  }
}

const MANIFEST_FILE: Record<Exclude<ScaffoldLanguage, 'ts'>, string> = {
  python: 'pyproject.toml',
  ruby: 'Gemfile',
  go: 'go.mod',
  rust: 'Cargo.toml',
}

export async function patchManifest(
  language: ScaffoldLanguage,
  target: string,
  versions: Map<string, string>,
): Promise<void> {
  if (language === 'ts') {
    await patchNpmPackageJson(target, versions)
    return
  }
  const fileName = MANIFEST_FILE[language]
  const filePath = join(target, fileName)
  const raw = await readFile(filePath, 'utf8')
  const next = rewriteManifest(language, raw, versions)
  if (next !== raw) {
    await writeFile(filePath, next, 'utf8')
  }
}

export function applyDevPathDeps(
  language: ScaffoldLanguage,
  raw: string,
  paths: Record<string, string>,
): string {
  if (language === 'python') {
    const sources = Object.entries(paths)
      .map(([name, pathValue]) => `${name} = { path = "${pathValue}", editable = true }`)
      .join('\n')
    if (raw.includes('[tool.uv.sources]')) {
      return raw.replace(/\[tool\.uv\.sources\][\s\S]*?(?=\n\[|$)/, `[tool.uv.sources]\n${sources}\n`)
    }
    return `${raw.trimEnd()}\n\n[tool.uv.sources]\n${sources}\n`
  }
  if (language === 'ruby') {
    let out = raw
    for (const [name, pathValue] of Object.entries(paths)) {
      const re = new RegExp(`gem\\s+"${name}"[^\\n]*`)
      out = out.replace(re, `gem "${name}", path: "${pathValue}"`)
    }
    return out
  }
  if (language === 'go') {
    const replaces = Object.entries(paths)
      .map(([name, pathValue]) => `replace ${name} => ${pathValue}`)
      .join('\n')
    return `${raw.trimEnd()}\n\n${replaces}\n`
  }
  if (language === 'rust') {
    let out = raw
    for (const [name, pathValue] of Object.entries(paths)) {
      const re = new RegExp(`(^|\\n)${name}\\s*=\\s*[^\\n]+`, 'm')
      out = out.replace(re, `$1${name} = { path = "${pathValue}" }`)
    }
    return out
  }
  return raw
}
