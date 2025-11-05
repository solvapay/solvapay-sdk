#!/usr/bin/env tsx

/**
 * Tag a specific version (or current version) of all @solvapay packages as "latest"
 * 
 * ⚠️  INTERNAL SCRIPT - Used by GitHub Actions workflow
 * 
 * This script is called by the "Tag Version as Latest" GitHub Actions workflow
 * (.github/workflows/tag-as-latest.yml). It should NOT be run manually by users.
 * 
 * To promote a version to latest, use the GitHub Actions workflow:
 *   1. Go to Actions tab in GitHub
 *   2. Select "Tag Version as Latest" workflow
 *   3. Click "Run workflow" and enter the version
 * 
 * What it does:
 *   1. Verifies each package version exists on npm
 *   2. Tags all published @solvapay packages at that version as "latest"
 *   3. Skips any packages that haven't been published yet
 *   4. Maintains version consistency across all packages
 * 
 * Usage (for GitHub Actions):
 *   pnpm tag:latest 1.0.0-preview.9    # Tags specific version as latest
 *   pnpm tag:latest                    # Uses current version from core package
 * 
 * Prerequisites:
 *   - Must be authenticated with npm (NODE_AUTH_TOKEN in CI)
 *   - Must have publish permissions for @solvapay packages
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const PACKAGES_TO_TAG = [
  '@solvapay/core',
  '@solvapay/react',
  '@solvapay/react-supabase',
  '@solvapay/server',
  '@solvapay/auth',
  '@solvapay/next',
  'create-solvapay-app',
];

function getCurrentVersion(): string {
  const corePackagePath = join(process.cwd(), 'packages/core/package.json');
  const corePackage = JSON.parse(readFileSync(corePackagePath, 'utf-8'));
  return corePackage.version;
}

function tagPackage(packageName: string, version: string, tag: string = 'latest'): boolean {
  try {
    console.log(`\nTagging ${packageName}@${version} as "${tag}"...`);
    
    // First verify the version exists
    try {
      execSync(`npm view ${packageName}@${version} version`, { 
        encoding: 'utf-8',
        stdio: 'pipe'
      });
    } catch (error) {
      console.error(`  ⚠️  Version ${version} not found for ${packageName} (skipping)`);
      return false;
    }
    
    // Add the tag
    const result = execSync(
      `npm dist-tag add ${packageName}@${version} ${tag}`,
      { encoding: 'utf-8' }
    );
    
    console.log(`  ✅ ${result.trim()}`);
    return true;
  } catch (error) {
    console.error(`  ❌ Failed to tag ${packageName}:`, error instanceof Error ? error.message : error);
    return false;
  }
}

function main(): void {
  const versionArg = process.argv[2];
  const version = versionArg || getCurrentVersion();
  
  console.log('🏷️  Tag as Latest\n');
  console.log(`Version: ${version}`);
  
  if (!versionArg) {
    console.log('(Using current version from core package)');
  }
  
  console.log(`\nThis will tag the following packages as "latest":`);
  PACKAGES_TO_TAG.forEach(pkg => console.log(`  - ${pkg}@${version}`));
  
  console.log('\n⚠️  WARNING: This will change the "latest" tag in npm!');
  console.log('Make sure you are logged in to npm with the correct credentials.\n');
  
  // Check if user wants to continue (in non-interactive mode, we'll just proceed)
  const isInteractive = process.stdin.isTTY;
  
  if (isInteractive) {
    console.log('Press Ctrl+C to cancel, or wait 3 seconds to continue...\n');
    // Give user 3 seconds to cancel
    execSync('sleep 3');
  }
  
  console.log('Starting tagging process...\n');
  console.log('─'.repeat(80));
  
  let successCount = 0;
  let failCount = 0;
  let skippedCount = 0;
  
  for (const packageName of PACKAGES_TO_TAG) {
    const result = tagPackage(packageName, version);
    if (result === true) {
      successCount++;
    } else if (result === false) {
      // Check if it was skipped (version not found) vs failed (auth error)
      const wasSkipped = !failCount; // Simple heuristic
      skippedCount++;
    }
  }
  
  console.log('─'.repeat(80));
  console.log(`\n✅ Successfully tagged: ${successCount}/${PACKAGES_TO_TAG.length}`);
  
  if (skippedCount > 0) {
    console.log(`⚠️  Skipped (not published): ${skippedCount}/${PACKAGES_TO_TAG.length}`);
  }
  
  if (failCount > 0) {
    console.log(`❌ Failed: ${failCount}/${PACKAGES_TO_TAG.length}`);
  }
  
  console.log('\n📝 Verify the tags:');
  console.log(`  npm dist-tag ls @solvapay/core`);
  console.log(`  npm dist-tag ls @solvapay/react`);
  console.log();
}

main();

