#!/usr/bin/env tsx

/**
 * Sync package.json versions from git tags
 *
 * This script reads the latest git tag (stable or preview) and updates all
 * package.json files to match that version. This is useful when package.json
 * versions have become out of sync with published versions.
 *
 * Usage:
 *   pnpm version:sync                    # Sync to latest stable tag
 *   pnpm version:sync --preview          # Sync to latest preview tag
 *   pnpm version:sync --tag v1.0.1       # Sync to specific tag
 *   pnpm version:sync --commit           # Also commit the changes
 *
 * Options:
 *   --preview    Sync to latest preview tag instead of stable
 *   --tag <tag>  Sync to a specific tag (e.g., v1.0.1 or v1.0.0-preview.19)
 *   --commit     Commit the changes after syncing
 */

import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'

const PACKAGES = [
  'packages/core/package.json',
  'packages/react/package.json',
  'packages/react-supabase/package.json',
  'packages/server/package.json',
  'packages/auth/package.json',
  'packages/next/package.json',
  'packages/create-solvapay-app/package.json',
]

function getLatestTag(preview: boolean = false): string {
  try {
    // Fetch all tags first
    execSync('git fetch --tags', { stdio: 'ignore' })
    
    if (preview) {
      // Get latest preview tag
      const tags = execSync('git tag -l "v*-preview.*" | sort -V', { encoding: 'utf-8' })
        .trim()
        .split('\n')
        .filter(Boolean)
      
      if (tags.length === 0) {
        throw new Error('No preview tags found')
      }
      
      return tags[tags.length - 1]
    } else {
      // Get latest stable tag (exclude preview tags)
      const tags = execSync('git tag -l "v*" | grep -v "preview" | sort -V', { encoding: 'utf-8' })
        .trim()
        .split('\n')
        .filter(Boolean)
      
      if (tags.length === 0) {
        throw new Error('No stable tags found')
      }
      
      return tags[tags.length - 1]
    }
  } catch (error) {
    throw new Error(`Failed to get latest tag: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function extractVersionFromTag(tag: string): string {
  // Remove 'v' prefix (e.g., v1.0.1 -> 1.0.1)
  return tag.replace(/^v/, '')
}

function updatePackageVersion(packagePath: string, newVersion: string): void {
  const fullPath = join(process.cwd(), packagePath)
  const packageJson = JSON.parse(readFileSync(fullPath, 'utf-8'))
  packageJson.version = newVersion
  writeFileSync(fullPath, JSON.stringify(packageJson, null, 2) + '\n')
  console.log(`✓ Updated ${packagePath} to ${newVersion}`)
}

function main(): void {
  const args = process.argv.slice(2)
  const preview = args.includes('--preview')
  const commit = args.includes('--commit')
  const tagIndex = args.indexOf('--tag')
  const specificTag = tagIndex !== -1 ? args[tagIndex + 1] : null

  let version: string
  let tag: string

  try {
    if (specificTag) {
      tag = specificTag.startsWith('v') ? specificTag : `v${specificTag}`
      version = extractVersionFromTag(tag)
      console.log(`Syncing to specific tag: ${tag}`)
    } else {
      tag = getLatestTag(preview)
      version = extractVersionFromTag(tag)
      const tagType = preview ? 'preview' : 'stable'
      console.log(`Latest ${tagType} tag: ${tag}`)
    }

    console.log(`\nSyncing all packages to version: ${version}\n`)

    // Update all package.json files
    PACKAGES.forEach((pkg) => {
      updatePackageVersion(pkg, version)
    })

    console.log(`\n✓ All packages synced to ${version}`)

    if (commit) {
      console.log('\nCommitting changes...')
      execSync('git add packages/*/package.json', { stdio: 'inherit' })
      execSync(`git commit -m "chore: sync package.json versions to ${version}"`, { stdio: 'inherit' })
      console.log('\n✓ Changes committed')
      console.log('  Run `git push` to push the changes')
    } else {
      console.log('\nℹ️  Changes are not committed. Use --commit to commit them.')
    }
  } catch (error) {
    console.error(`\n❌ Error: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

main()

