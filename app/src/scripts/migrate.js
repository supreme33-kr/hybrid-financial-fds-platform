import { readFile } from 'node:fs/promises';
import pg from 'pg';

const { Client } = pg;
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL must be set before running migrations.');
}

const migrationUrl = new URL(
  '../../../database/migrations/001_create_transactions.sql',
  import.meta.url,
);
const migrationSql = await readFile(migrationUrl, 'utf8');
const client = new Client({
  connectionString,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

try {
  await client.connect();
  await client.query('BEGIN');
  await client.query(migrationSql);
  await client.query('COMMIT');
  console.log('Migration 001_create_transactions.sql completed.');
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  console.error('Migration failed:', error);
  process.exitCode = 1;
} finally {
  await client.end();
}
