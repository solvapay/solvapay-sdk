import { writeFileSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';

const OPENAPI_URL = 'http://localhost:3001/v1/openapi.json';
const OUTPUT_FILE = './src/types/generated.ts';
const TEMP_SPEC_FILE = './temp-filtered-openapi.json';
const PATH_PREFIX = '/v1/sdk/';

interface OpenAPISpec {
  paths?: Record<string, any>;
  [key: string]: any;
}

async function main(): Promise<void> {
  console.log('Fetching OpenAPI spec from', OPENAPI_URL);
  
  try {
    // Fetch the OpenAPI spec
    const response = await fetch(OPENAPI_URL);
    if (!response.ok) {
      throw new Error(`Failed to fetch OpenAPI spec: ${response.status} ${response.statusText}`);
    }
    
    const spec = await response.json() as OpenAPISpec;
    console.log(`Fetched OpenAPI spec with ${Object.keys(spec.paths || {}).length} paths`);
    
    // Filter paths to only include SDK routes
    const filteredPaths: Record<string, any> = {};
    for (const [path, methods] of Object.entries(spec.paths || {})) {
      if (path.startsWith(PATH_PREFIX)) {
        filteredPaths[path] = methods;
      }
    }
    
    console.log(`Filtered to ${Object.keys(filteredPaths).length} SDK paths (matching ${PATH_PREFIX}*)`);
    
    if (Object.keys(filteredPaths).length === 0) {
      console.error(`ERROR: No paths found matching prefix "${PATH_PREFIX}"`);
      console.error('Available paths:', Object.keys(spec.paths || {}).slice(0, 10).join(', '), '...');
      process.exit(1);
    }
    
    // Create filtered spec
    const filteredSpec: OpenAPISpec = {
      ...spec,
      paths: filteredPaths
    };
    
    // Write filtered spec to temp file
    console.log('Writing filtered spec to', TEMP_SPEC_FILE);
    writeFileSync(TEMP_SPEC_FILE, JSON.stringify(filteredSpec, null, 2));
    
    // Generate types from filtered spec
    console.log('Generating TypeScript types...');
    execSync(
      `npx openapi-typescript ${TEMP_SPEC_FILE} -o ${OUTPUT_FILE}`,
      { stdio: 'inherit' }
    );
    
    // Clean up temp file
    console.log('Cleaning up...');
    unlinkSync(TEMP_SPEC_FILE);
    
    console.log('✅ Types generated successfully!');
  } catch (error) {
    // Clean up temp file if it exists
    try {
      unlinkSync(TEMP_SPEC_FILE);
    } catch {}
    
    console.error('❌ Error generating types:', (error as Error).message);
    process.exit(1);
  }
}

main();

