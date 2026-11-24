import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';

function validateNeonUrl(urlString: string): void {
  const parsed = new URL(urlString);
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL must use postgres:// or postgresql://');
  }
  if (!parsed.hostname.includes('neon.tech') && process.env.ALLOW_NON_NEON_TEST_DB !== 'true') {
    throw new Error('Production database must be a Neon PostgreSQL host (*.neon.tech). Supabase is forbidden.');
  }
  if (parsed.hostname.includes('supabase')) {
    throw new Error('Supabase database URLs are strictly prohibited.');
  }
  const sslMode = parsed.searchParams.get('sslmode');
  if (sslMode !== 'require' && sslMode !== 'verify-full') {
    throw new Error('Neon DATABASE_URL must enforce sslmode=require or sslmode=verify-full');
  }
}

async function runMigrations() {
  const connectionString = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('Missing DATABASE_URL or DATABASE_URL_DIRECT. Configure your Neon Free PostgreSQL URL first.');
    process.exit(1);
  }
  validateNeonUrl(connectionString);

  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  const migrationsDir = path.join(process.cwd(), 'db', 'migrations');
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _reel_gen_migrations (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    for (const file of files) {
      const existing = await client.query('SELECT id FROM _reel_gen_migrations WHERE id = $1', [file]);
      if (existing.rowCount && existing.rowCount > 0) {
        console.log(`Skipping already applied migration: ${file}`);
        continue;
      }
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _reel_gen_migrations (id) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`Applied migration: ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
    console.log('All Neon PostgreSQL migrations applied successfully.');
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
