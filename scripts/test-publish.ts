#!/usr/bin/env tsx

/**
 * Test script to verify which packages would be published
 * This simulates what pnpm publish would do without actually publishing
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const PACKAGES_TO_CHECK = [
  { name: '@solvapay/core', path: 'packages/core' },
  { name: '@solvapay/react', path: 'packages/react' },
  { name: '@solvapay/react-supabase', path: 'packages/react-supabase' },
  { name: '@solvapay/server', path: 'packages/server' },
  { name: '@solvapay/auth', path: 'packages/auth' },
  { name: '@solvapay/next', path: 'packages/next' },
];

interface PackageInfo {
  name: string;
  version: string;
  path: string;
  hasDist: boolean;
  distFiles: string[];
}

function checkPackage(pkg: { name: string; path: string }): PackageInfo {
  const packageJsonPath = join(process.cwd(), pkg.path, 'package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  
  const distPath = join(process.cwd(), pkg.path, 'dist');
  let hasDist = false;
  let distFiles: string[] = [];
  
  try {
    const { readdirSync, statSync } = require('fs');
    if (statSync(distPath).isDirectory()) {
      hasDist = true;
      distFiles = readdirSync(distPath, { recursive: true });
    }
  } catch (error) {
    // dist directory doesn't exist
  }
  
  return {
    name: pkg.name,
    version: packageJson.version,
    path: pkg.path,
    hasDist,
    distFiles: distFiles.slice(0, 5), // Show first 5 files
  };
}

function main(): void {
  console.log('\n🧪 Testing Publish Command\n');
  console.log('Checking which packages would be published...\n');
  
  const packages: PackageInfo[] = [];
  
  for (const pkg of PACKAGES_TO_CHECK) {
    try {
      const info = checkPackage(pkg);
      packages.push(info);
    } catch (error) {
      console.error(`❌ Error checking ${pkg.name}:`, error);
    }
  }
  
  // Display results
  console.log('Package Status:');
  console.log('─'.repeat(80));
  
  let allReady = true;
  for (const pkg of packages) {
    const status = pkg.hasDist ? '✅' : '❌';
    const distStatus = pkg.hasDist 
      ? `${pkg.distFiles.length} file(s)` 
      : 'MISSING';
    
    console.log(`${status} ${pkg.name.padEnd(25)} v${pkg.version.padEnd(20)} dist: ${distStatus}`);
    
    if (!pkg.hasDist) {
      allReady = false;
    }
  }
  
  console.log('─'.repeat(80));
  console.log();
  
  if (!allReady) {
    console.log('⚠️  Some packages are missing dist folders. Run: pnpm build:packages');
    console.log();
  }
  
  // Test the filter pattern
  console.log('Testing pnpm filter pattern...\n');
  try {
    const result = execSync(
      'pnpm --filter=@solvapay/* list --depth=0 --json',
      { encoding: 'utf-8', cwd: process.cwd() }
    );
    
    const filtered = JSON.parse(result);
    const packageNames = filtered
      .map((pkg: any) => pkg.name)
      .filter((name: string) => name?.startsWith('@solvapay/'))
      .sort();
    
    console.log(`Found ${packageNames.length} package(s) matching filter '@solvapay/*':`);
    packageNames.forEach((name: string) => {
      const pkg = packages.find(p => p.name === name);
      const version = pkg ? `v${pkg.version}` : 'unknown';
      console.log(`  ✓ ${name} ${version}`);
    });
    
    if (packageNames.length !== PACKAGES_TO_CHECK.length) {
      console.log(`\n⚠️  Expected ${PACKAGES_TO_CHECK.length} packages, found ${packageNames.length}`);
    } else {
      console.log(`\n✅ All ${PACKAGES_TO_CHECK.length} packages matched correctly!`);
    }
  } catch (error) {
    console.error('❌ Error testing filter pattern:', error);
  }
  
  console.log('\n📝 Next steps:');
  console.log('  1. Ensure all packages are built: pnpm build:packages');
  console.log('  2. Test dry-run publish: pnpm --filter=@solvapay/* publish --dry-run --tag preview');
  console.log('  3. If dry-run looks good, publish: pnpm publish:preview');
  console.log();
}

main();

