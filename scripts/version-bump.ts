#!/usr/bin/env tsx

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

type BumpType = 'patch' | 'minor' | 'major';

const PACKAGES_TO_VERSION = [
  'packages/core/package.json',
  'packages/react/package.json',
  'packages/react-supabase/package.json',
  'packages/server/package.json',
  'packages/auth/package.json',
  'packages/next/package.json',
  'packages/create-solvapay-app/package.json',
];

function parseVersion(version: string): { major: number; minor: number; patch: number } {
  // Handle prerelease versions like "1.0.0-preview.5" by extracting just the base version
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  
  if (!match) {
    throw new Error(`Invalid version format: ${version}`);
  }
  
  const [, major, minor, patch] = match;
  return { 
    major: parseInt(major, 10), 
    minor: parseInt(minor, 10), 
    patch: parseInt(patch, 10) 
  };
}

function incrementVersion(version: string, type: BumpType): string {
  const { major, minor, patch } = parseVersion(version);
  
  switch (type) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(`Unknown bump type: ${type}`);
  }
}

function updatePackageVersion(packagePath: string, newVersion: string): void {
  const fullPath = join(process.cwd(), packagePath);
  const packageJson = JSON.parse(readFileSync(fullPath, 'utf-8'));
  packageJson.version = newVersion;
  writeFileSync(fullPath, JSON.stringify(packageJson, null, 2) + '\n');
  console.log(`✓ Updated ${packagePath} to ${newVersion}`);
}

function generateChangelog(newVersion: string): void {
  console.log('\n📝 Generating changelog...');
  try {
    execSync(
      `npx conventional-changelog -p angular -i CHANGELOG.md -s -r 0`,
      { stdio: 'inherit' }
    );
    console.log('✓ Changelog generated');
  } catch (error) {
    console.error('⚠️  Failed to generate changelog:', error);
    // Don't fail the version bump if changelog generation fails
  }
}

function main(): void {
  const bumpType: BumpType = (process.argv[2] as BumpType) || 'patch';
  
  if (!['patch', 'minor', 'major'].includes(bumpType)) {
    console.error('Usage: tsx scripts/version-bump.ts [patch|minor|major]');
    console.error('Default: patch');
    process.exit(1);
  }

  console.log(`\n🚀 Version Bump: ${bumpType.toUpperCase()}\n`);

  // Read current version from core package
  const corePackagePath = join(process.cwd(), PACKAGES_TO_VERSION[0]);
  const corePackage = JSON.parse(readFileSync(corePackagePath, 'utf-8'));
  const currentVersion = corePackage.version;
  const newVersion = incrementVersion(currentVersion, bumpType);

  console.log(`Current version: ${currentVersion}`);
  console.log(`New version: ${newVersion}\n`);

  // Update all package versions
  for (const packagePath of PACKAGES_TO_VERSION) {
    updatePackageVersion(packagePath, newVersion);
  }

  // Generate changelog
  generateChangelog(newVersion);

  console.log(`\n✅ Version bump complete: ${currentVersion} → ${newVersion}\n`);
  console.log('Next steps:');
  console.log('  1. Review the changes');
  console.log('  2. Commit: git add . && git commit -m "chore: bump version to ' + newVersion + '"');
  console.log('  3. Push to main branch to trigger automated publishing\n');
}

main();

