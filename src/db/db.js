/**
 * Shared Drizzle database client backed by a node-postgres connection pool.
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not defined');
}

/** Postgres connection pool for the application. */
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/** Drizzle ORM client used for queries and mutations. */
export const db = drizzle(pool);
