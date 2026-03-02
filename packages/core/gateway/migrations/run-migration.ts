#!/usr/bin/env node
/**
 * Migration runner for PostgreSQL sessions store
 *
 * Usage:
 *   npx tsx migrations/run-migration.ts <migration-file> [--schema=<schema-name>]
 *
 * Example:
 *   npx tsx migrations/run-migration.ts 001-add-session-management-fields.sql
 *   npx tsx migrations/run-migration.ts 001-add-session-management-fields.sql --schema=nachos_prod
 */

import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { resolve, join } from 'path';

async function runMigration() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: npx tsx run-migration.ts <migration-file> [--schema=<schema-name>]');
    process.exit(1);
  }

  const migrationFile = args[0];
  const schemaArg = args.find((arg) => arg.startsWith('--schema='));
  const schema = schemaArg ? schemaArg.split('=')[1] : 'public';

  // Read database URL from environment
  const dbUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('Error: POSTGRES_URL or DATABASE_URL environment variable not set');
    process.exit(1);
  }

  // Read migration file
  const migrationPath = resolve(join(__dirname, migrationFile));
  let sql: string;

  try {
    sql = readFileSync(migrationPath, 'utf-8');
  } catch (err) {
    console.error(`Error reading migration file: ${migrationPath}`);
    console.error(err);
    process.exit(1);
  }

  // Connect to database
  const pool = new Pool({
    connectionString: dbUrl,
    max: 1,
  });

  try {
    console.log(`Running migration: ${migrationFile}`);
    console.log(`Schema: ${schema}`);
    console.log('---');

    // Create schema if it doesn't exist
    await pool.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);

    // Set search path to target schema
    await pool.query(`SET search_path TO "${schema}"`);

    // Run migration SQL
    await pool.query(sql);

    console.log('✅ Migration completed successfully');
  } catch (err) {
    console.error('❌ Migration failed:');
    console.error(err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
