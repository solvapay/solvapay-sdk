#!/usr/bin/env tsx

/**
 * Initialize Supabase Database
 *
 * This script sets up the Tasks table in Supabase.
 * Run this script once to initialize your database schema.
 *
 * Usage:
 *   pnpm init:db
 *   or
 *   tsx scripts/init-db.ts
 *
 * Requirements:
 *   - Install pg: pnpm add -D pg @types/pg
 *   - Set SUPABASE_DB_URL or SUPABASE_DB_PASSWORD in .env.local
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import { config } from 'dotenv'

// Load environment variables from .env.local
config({ path: '.env.local' })
config({ path: '.env' })

/**
 * URL-encode special characters in PostgreSQL connection string password
 * This handles cases where Supabase provides passwords with special characters
 */
function encodePasswordInConnectionString(connectionString: string): string {
  // Find the hostname pattern to locate where password ends
  // Pattern: @db.xxxxx.supabase.co
  const hostnameMatch = connectionString.match(/@(db\.[^:/]+\.supabase\.co)/)

  if (!hostnameMatch) {
    return connectionString // Can't find hostname, return as-is
  }

  const hostnameStart = connectionString.indexOf(hostnameMatch[0])
  const beforeHostname = connectionString.substring(0, hostnameStart)

  // Extract password: between the last : and the @ before hostname
  // Format: postgresql://user:password@
  const passwordMatch = beforeHostname.match(/:\/\/([^:]+):(.+)$/)

  if (!passwordMatch) {
    return connectionString // Can't parse, return as-is
  }

  const [, username, password] = passwordMatch

  // Check if password needs encoding (has unencoded special chars)
  if (/[@&#%+=\s]/.test(password) && !password.includes('%')) {
    // Has special chars that aren't encoded
    const encodedPassword = encodeURIComponent(password)
    return connectionString.replace(
      `://${username}:${password}@`,
      `://${username}:${encodedPassword}@`,
    )
  }

  // If password contains % but also has @, &, # - might be partially encoded
  if (
    password.includes('%') &&
    (password.includes('@') || password.includes('&') || password.includes('#'))
  ) {
    // Double-encode might be needed, but let's try encoding the whole thing
    const encodedPassword = encodeURIComponent(password)
    return connectionString.replace(
      `://${username}:${password}@`,
      `://${username}:${encodedPassword}@`,
    )
  }

  return connectionString
}

async function initDatabase() {
  // Check if pg is available
  let pg: any
  try {
    pg = require('pg')
  } catch (error) {
    console.error('❌ Error: pg library is not installed.')
    console.error('\n📦 Please install it first:')
    console.error('   pnpm add -D pg @types/pg\n')
    process.exit(1)
  }

  const { Client } = pg

  // Get database connection details
  // Option 1: Direct database URL (from Supabase Dashboard → Settings → Database → Connection string → URI)
  let dbUrl = process.env.SUPABASE_DB_URL

  // Auto-encode password if needed
  if (dbUrl) {
    const originalUrl = dbUrl
    dbUrl = encodePasswordInConnectionString(dbUrl)

    if (dbUrl !== originalUrl) {
      console.log('ℹ️  Auto-encoded special characters in password for connection string')
    }
  }

  // Option 2: Construct from Supabase project details
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const dbPassword = process.env.SUPABASE_DB_PASSWORD
  const dbHost = process.env.SUPABASE_DB_HOST
  const dbPort = process.env.SUPABASE_DB_PORT || '5432'
  const dbName = process.env.SUPABASE_DB_NAME || 'postgres'
  const dbUser = process.env.SUPABASE_DB_USER || 'postgres'

  if (!dbUrl && (!supabaseUrl || !dbPassword)) {
    console.error('❌ Error: Database connection details not found.')
    console.error('\n📝 Please set one of the following in .env.local:')
    console.error('   Option 1 (recommended):')
    console.error('   SUPABASE_DB_URL=postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres')
    console.error('')
    console.error('   Option 2:')
    console.error('   SUPABASE_DB_PASSWORD=your_database_password')
    console.error('   SUPABASE_DB_HOST=db.xxxxx.supabase.co (from Supabase Dashboard)')
    console.error('   SUPABASE_DB_PORT=5432 (optional, default: 5432)')
    console.error('   SUPABASE_DB_NAME=postgres (optional, default: postgres)')
    console.error('   SUPABASE_DB_USER=postgres (optional, default: postgres)')
    console.error('')
    console.error(
      '💡 Get these from: Supabase Dashboard → Settings → Database → Connection string\n',
    )
    process.exit(1)
  }

  // Create database client
  let client: any

  if (dbUrl) {
    console.log('🔌 Connecting to Supabase database via URL...')

    // Validate connection string format (basic check)
    if (!dbUrl.startsWith('postgresql://') && !dbUrl.startsWith('postgres://')) {
      console.error('❌ Error: Connection string must start with postgresql:// or postgres://')
      console.error(`   Got: ${dbUrl.substring(0, 50)}...`)
      process.exit(1)
    }

    // Check for placeholder values
    if (
      dbUrl.includes('[PASSWORD]') ||
      dbUrl.includes('[PROJECT_REF]') ||
      dbUrl.includes('[HOST]')
    ) {
      console.error('❌ Error: Connection string contains placeholder values.')
      console.error('   Please replace [PASSWORD], [PROJECT_REF], and [HOST] with actual values.')
      console.error(
        '   Format: postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres',
      )
      process.exit(1)
    }

    client = new Client({
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false }, // Supabase requires SSL
    })
  } else {
    // Extract project reference from Supabase URL to build database host
    let host = dbHost
    if (!host && supabaseUrl) {
      const urlMatch = supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/)
      if (urlMatch) {
        host = `db.${urlMatch[1]}.supabase.co`
      } else {
        throw new Error(
          'Could not extract database host from SUPABASE_URL. Please set SUPABASE_DB_HOST manually.',
        )
      }
    }

    if (!host) {
      throw new Error('SUPABASE_DB_HOST or NEXT_PUBLIC_SUPABASE_URL must be set')
    }

    console.log('🔌 Connecting to Supabase database...')
    console.log(`   Host: ${host}`)
    console.log(`   Database: ${dbName}`)
    console.log(`   User: ${dbUser}`)

    client = new Client({
      host,
      port: parseInt(dbPort),
      database: dbName,
      user: dbUser,
      password: dbPassword,
      ssl: { rejectUnauthorized: false }, // Supabase requires SSL
    })
  }

  try {
    await client.connect()
    console.log('✅ Connected to database\n')

    // Read the SQL migration files
    const migrationsDir = join(process.cwd(), 'supabase', 'migrations')
    const migrationFiles = ['001_create_tasks_table.sql', '002_create_oauth_tables.sql']

    for (const file of migrationFiles) {
      const migrationPath = join(migrationsDir, file)
      let sql: string

      try {
        sql = readFileSync(migrationPath, 'utf-8')
        console.log(`📄 Read migration file: ${file}\n`)
      } catch (error) {
        throw new Error(`Failed to read migration file: ${migrationPath}\n${error}`)
      }

      // Execute the SQL
      console.log(`📝 Executing SQL migration: ${file}...\n`)

      try {
        await client.query(sql)
        console.log(`✅ Migration ${file} executed successfully!\n`)
      } catch (error: any) {
        // Check if error is because table already exists
        if (error.message.includes('already exists') || error.code === '42P07') {
          console.log(`⚠️  Warning: Objects in ${file} already exist`)
          console.log("   This is normal if you've run this script before.")
          console.log('   Migration will continue...\n')
        } else {
          throw error
        }
      }
    }

    // Verify the tables were created
    const tableCheck = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name IN ('tasks', 'oauth_codes', 'oauth_refresh_tokens');
      `)
      
    const foundTables = tableCheck.rows.map((row: any) => row.table_name)
    console.log(`✅ Verified tables exist: ${foundTables.join(', ')}`)

    console.log('\n✨ Database initialization complete!')
  } catch (error: any) {
    console.error('❌ Error initializing database:', error.message)
    process.exit(1)
  } finally {
    await client.end()
    console.log('🔌 Database connection closed')
  }
}

// Run the initialization
initDatabase().catch(error => {
  console.error('❌ Fatal error:', error)
  process.exit(1)
})
