#!/usr/bin/env tsx

import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const PACKAGES_TO_VERSION = [
  'packages/core/package.json',
  'packages/react/package.json',
  'packages/react-supabase/package.json',
  'packages/server/package.json',
  'packages/auth/package.json',
  'packages/next/package.json',
  'packages/create-solvapay-app/package.json',
]

interface ParsedVersion {
  base: string // e.g., "0.1.0"
  prerelease?: string // e.g., "preview"
  prereleaseNumber?: number // e.g., 1
}

function parseVersion(version: string): ParsedVersion {
  // Match pattern: 0.1.0 or 0.1.0-preview.1
  const match = version.match(/^(\d+\.\d+\.\d+)(?:-([a-z]+)\.(\d+))?$/)

  if (!match) {
    throw new Error(`Invalid version format: ${version}`)
  }

  const [, base, prerelease, prereleaseNum] = match

  return {
    base,
    prerelease,
    prereleaseNumber: prereleaseNum ? parseInt(prereleaseNum, 10) : undefined,
  }
}

function incrementPreviewVersion(version: string): string {
  const parsed = parseVersion(version)

  // If already a preview version, increment the preview number
  if (parsed.prerelease === 'preview' && parsed.prereleaseNumber !== undefined) {
    return `${parsed.base}-preview.${parsed.prereleaseNumber + 1}`
  }

  // If it's a stable version, start at preview.1
  return `${parsed.base}-preview.1`
}

function updatePackageVersion(packagePath: string, newVersion: string): void {
  const fullPath = join(process.cwd(), packagePath)
  const packageJson = JSON.parse(readFileSync(fullPath, 'utf-8'))
  packageJson.version = newVersion
  writeFileSync(fullPath, JSON.stringify(packageJson, null, 2) + '\n')
  console.log(`✓ Updated ${packagePath} to ${newVersion}`)
}

function main(): void {
  console.log('\n🔮 Preview Version Bump\n')

  // Read current version from core package
  const corePackagePath = join(process.cwd(), PACKAGES_TO_VERSION[0])
  const corePackage = JSON.parse(readFileSync(corePackagePath, 'utf-8'))
  const currentVersion = corePackage.version
  const newVersion = incrementPreviewVersion(currentVersion)

  console.log(`Current version: ${currentVersion}`)
  console.log(`New version: ${newVersion}\n`)

  // Update all package versions
  for (const packagePath of PACKAGES_TO_VERSION) {
    updatePackageVersion(packagePath, newVersion)
  }

  console.log(`\n✅ Preview version bump complete: ${currentVersion} → ${newVersion}\n`)
  console.log('Next steps:')
  console.log('  1. Build packages: pnpm build:packages')
  console.log('  2. Publish preview: pnpm publish:preview')
  console.log('  3. Test install: npm install @solvapay/core@preview')
  console.log(
    '  4. Commit changes: git add . && git commit -m "chore: bump preview to ' + newVersion + '"',
  )
  console.log('  5. Push to dev: git push origin dev\n')
}

main()
