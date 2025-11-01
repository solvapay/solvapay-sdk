import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// User plan storage file path
const USER_PLANS_FILE = join(process.cwd(), 'user-plans.json');

/**
 * Debug endpoint to check file system info
 */
export async function GET() {
  const cwd = process.cwd();
  const fileExists = existsSync(USER_PLANS_FILE);
  let fileContent = '';
  
  if (fileExists) {
    try {
      fileContent = readFileSync(USER_PLANS_FILE, 'utf8');
    } catch (err) {
      fileContent = 'Error reading file: ' + err;
    }
  }
  
  return NextResponse.json({
    cwd,
    filePath: USER_PLANS_FILE,
    fileExists,
    fileContent
  });
}
