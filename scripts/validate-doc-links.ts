#!/usr/bin/env tsx
/**
 * Validates markdown links in documentation files
 * Checks that all relative links point to existing files
 */

import { readFileSync, existsSync, statSync } from 'fs';
import { join, dirname, resolve, normalize } from 'path';
import { glob } from 'glob';

interface LinkIssue {
  file: string;
  line: number;
  link: string;
  resolvedPath: string;
  issue: 'broken' | 'invalid';
}

const DOCS_DIR = resolve(__dirname, '../docs');
const ROOT_DIR = resolve(__dirname, '..');

// Patterns to match markdown links: [text](path) or [text](path#anchor)
const LINK_PATTERN = /\[([^\]]+)\]\(([^)]+)\)/g;
const ANCHOR_PATTERN = /^(.+?)(#.+)?$/;

function extractLinks(content: string, filePath: string): Array<{ link: string; line: number }> {
  const links: Array<{ link: string; line: number }> = [];
  const lines = content.split('\n');

  // Track if we're inside a code block
  let inCodeBlock = false;
  let codeBlockDelimiter = '';

  lines.forEach((line, index) => {
    // Check for code block start/end
    const codeBlockMatch = line.match(/^(\s*)(```|~~~)/);
    if (codeBlockMatch) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockDelimiter = codeBlockMatch[2];
      } else if (codeBlockMatch[2] === codeBlockDelimiter) {
        inCodeBlock = false;
        codeBlockDelimiter = '';
      }
    }

    // Skip links inside code blocks
    if (inCodeBlock) {
      return;
    }

    // Check for inline code (backticks)
    // Simple heuristic: if line has backticks, check if link is inside them
    const inlineCodePattern = /`[^`]*`/g;
    const inlineCodeRanges: Array<{ start: number; end: number }> = [];
    let match;
    while ((match = inlineCodePattern.exec(line)) !== null) {
      inlineCodeRanges.push({
        start: match.index,
        end: match.index + match[0].length,
      });
    }

    // Extract links
    while ((match = LINK_PATTERN.exec(line)) !== null) {
      const linkPath = match[2];
      const linkStart = match.index;
      const linkEnd = match.index + match[0].length;

      // Skip if link is inside inline code
      const isInInlineCode = inlineCodeRanges.some(
        (range) => linkStart >= range.start && linkEnd <= range.end
      );

      if (isInInlineCode) {
        continue;
      }

      // Skip external links (http/https/mailto)
      if (!/^(https?|mailto):/i.test(linkPath)) {
        links.push({
          link: linkPath,
          line: index + 1,
        });
      }
    }
  });

  return links;
}

function resolveLinkPath(linkPath: string, fromFile: string): string | null {
  // Skip anchor-only links (e.g., #section)
  if (linkPath.startsWith('#')) {
    return null; // Valid internal anchor, skip validation
  }

  // Skip absolute paths starting with / (likely for docs site, not relative)
  if (linkPath.startsWith('/')) {
    return null; // Absolute path for docs site, skip
  }

  // Remove anchor if present
  const match = linkPath.match(ANCHOR_PATTERN);
  if (!match) return null;

  const pathPart = match[1];
  const anchor = match[2];

  // Skip empty links
  if (!pathPart || pathPart.trim() === '') {
    return null;
  }

  // Resolve relative to the file's directory
  const fromDir = dirname(fromFile);
  const resolved = normalize(join(fromDir, pathPart));

  // Check if it's within the repo
  if (!resolved.startsWith(ROOT_DIR)) {
    return null; // External path, skip
  }

  return resolved;
}

function checkLink(linkPath: string, resolvedPath: string, skipApiValidation: boolean = false): 'broken' | 'valid' {
  const apiPath = join(ROOT_DIR, 'docs', 'api');
  
  // Special case: Links to docs/api/** 
  if (resolvedPath.startsWith(apiPath)) {
    if (skipApiValidation) {
      // Skip validation for docs/api/** before docs are built
      // These are generated files that don't exist yet
      return 'valid';
    }
    // After docs are built, validate docs/api/** links normally
    // Fall through to normal validation below
  }

  // Check if file exists
  if (!existsSync(resolvedPath)) {
    return 'broken';
  }

  // Check if it's a directory
  const stat = statSync(resolvedPath);
  if (stat.isDirectory()) {
    // Directory links are valid if:
    // 1. Has index.md or README.md, OR
    // 2. Has any .md files (some docs sites handle directory listings)
    const indexFiles = ['index.md', 'README.md'];
    const hasIndex = indexFiles.some((file) =>
      existsSync(join(resolvedPath, file))
    );

    if (hasIndex) {
      return 'valid';
    }

    // Check if directory has any markdown files (lenient check)
    try {
      const files = require('fs').readdirSync(resolvedPath);
      const hasMarkdown = files.some((file: string) => file.endsWith('.md'));
      if (hasMarkdown) {
        return 'valid'; // Directory has markdown files, likely valid
      }
    } catch {
      // If we can't read directory, consider it broken
    }

    return 'broken';
  }

  return 'valid';
}

function validateLinks(skipApiValidation: boolean = false): LinkIssue[] {
  const issues: LinkIssue[] = [];

  // Find all markdown files in docs directory
  // Skip generated TypeDoc files:
  // - `docs/api/**` - All TypeDoc-generated API documentation (auto-generated)
  // - `**/_media/**` - TypeDoc media files (they have different link semantics)
  const markdownFiles = glob.sync('**/*.md', {
    cwd: DOCS_DIR,
    absolute: true,
    ignore: [
      '**/node_modules/**',
      '**/dist/**',
      '**/_media/**',
      '**/api/**', // Exclude all TypeDoc-generated API documentation
    ],
  });

  console.log(`📄 Found ${markdownFiles.length} markdown files to check...\n`);
  if (skipApiValidation) {
    console.log('ℹ️  Skipping validation for docs/api/** links (will be validated after docs build)\n');
  }

  for (const file of markdownFiles) {
    try {
      const content = readFileSync(file, 'utf-8');
      const links = extractLinks(content, file);

      for (const { link, line } of links) {
        const resolvedPath = resolveLinkPath(link, file);

        if (!resolvedPath) {
          // External link or invalid format - skip
          continue;
        }

        const status = checkLink(link, resolvedPath, skipApiValidation);
        if (status === 'broken') {
          issues.push({
            file: file.replace(ROOT_DIR + '/', ''),
            line,
            link,
            resolvedPath: resolvedPath.replace(ROOT_DIR + '/', ''),
            issue: 'broken',
          });
        }
      }
    } catch (error) {
      console.error(`❌ Error reading ${file}:`, error);
    }
  }

  return issues;
}

function main() {
  // Check if --skip-api flag is provided (for validation before docs build)
  const skipApiValidation = process.argv.includes('--skip-api');
  
  console.log('🔍 Validating documentation links...\n');

  const issues = validateLinks(skipApiValidation);

  if (issues.length === 0) {
    console.log('✅ All links are valid!');
    process.exit(0);
  }

  console.log(`❌ Found ${issues.length} broken link(s):\n`);

  // Group by file
  const issuesByFile = new Map<string, LinkIssue[]>();
  for (const issue of issues) {
    if (!issuesByFile.has(issue.file)) {
      issuesByFile.set(issue.file, []);
    }
    issuesByFile.get(issue.file)!.push(issue);
  }

  // Print issues grouped by file
  for (const [file, fileIssues] of issuesByFile.entries()) {
    console.log(`📄 ${file}`);
    for (const issue of fileIssues) {
      console.log(`   Line ${issue.line}: ${issue.link}`);
      console.log(`   → Expected: ${issue.resolvedPath}`);
    }
    console.log('');
  }

  console.log(`\n❌ Validation failed: ${issues.length} broken link(s) found`);
  process.exit(1);
}

main();

