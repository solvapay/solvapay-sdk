import { writeFileSync, unlinkSync, readFileSync } from 'fs'
import { execSync } from 'child_process'
import {
  addMissingSchemaPlaceholders,
  EXCLUDED_PATH_PREFIXES,
  filterSdkPaths,
  PATH_PREFIX,
  pruneUnreferencedSchemas,
  type OpenApiSpec,
} from '../../../scripts/lib/openapi-pipeline'

const OPENAPI_URL = 'http://localhost:3001/v1/openapi.json'
const OUTPUT_FILE = './src/types/generated.ts'
const TEMP_SPEC_FILE = './temp-filtered-openapi.json'

async function main(): Promise<void> {
  console.log('Fetching OpenAPI spec from', OPENAPI_URL)

  try {
    const response = await fetch(OPENAPI_URL)
    if (!response.ok) {
      throw new Error(`Failed to fetch OpenAPI spec: ${response.status} ${response.statusText}`)
    }

    const spec = (await response.json()) as OpenApiSpec
    console.log(`Fetched OpenAPI spec with ${Object.keys(spec.paths || {}).length} paths`)

    const excludedPaths = Object.keys(spec.paths || {}).filter(path =>
      EXCLUDED_PATH_PREFIXES.some(prefix => path.startsWith(prefix)),
    )

    const filtered = filterSdkPaths(spec)
    console.log(
      `Filtered to ${Object.keys(filtered.paths || {}).length} SDK paths (matching ${PATH_PREFIX}*)`,
    )
    if (excludedPaths.length > 0) {
      console.warn(
        `Skipping ${excludedPaths.length} SDK paths due to known invalid refs: ${excludedPaths.join(
          ', ',
        )}`,
      )
    }

    const { spec: prunedSpec, pruned: prunedSchemas } = pruneUnreferencedSchemas(filtered)
    console.log(`Pruned ${prunedSchemas} unreachable schemas`)

    const { spec: finalSpec, added: missingSchemasAdded } = addMissingSchemaPlaceholders(prunedSpec)
    if (missingSchemasAdded > 0) {
      console.warn(
        `Added ${missingSchemasAdded} placeholder component schema(s) for unresolved $ref values`,
      )
    }

    // Keep non-canonical JSON.stringify so openapi-typescript input matches prior behavior.
    console.log('Writing filtered spec to', TEMP_SPEC_FILE)
    writeFileSync(TEMP_SPEC_FILE, JSON.stringify(finalSpec, null, 2))

    console.log('Generating TypeScript types...')
    execSync(`npx openapi-typescript ${TEMP_SPEC_FILE} -o ${OUTPUT_FILE}`, { stdio: 'inherit' })

    console.log('Converting @description tags to TypeDoc-compatible format...')
    let generatedContent = readFileSync(OUTPUT_FILE, 'utf-8')

    generatedContent = generatedContent.replace(
      /(\/\*\*)\n(\s*)\*\s*@description\s+([^\n]+)/g,
      (_match, commentStart: string, indent: string, description: string) => {
        return `${commentStart}\n${indent}* ${description.trim()}`
      },
    )

    writeFileSync(OUTPUT_FILE, generatedContent)

    console.log('Cleaning up...')
    unlinkSync(TEMP_SPEC_FILE)

    console.log('✅ Types generated successfully!')
  } catch (error) {
    try {
      unlinkSync(TEMP_SPEC_FILE)
    } catch {
      // Temp file may not exist
    }

    console.error('❌ Error generating types:', error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

main()
