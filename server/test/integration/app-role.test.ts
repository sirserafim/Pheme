import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkDatabase } from '../../src/db/health.ts';
import { createPool } from '../../src/db/pool.ts';
import { createLogger } from '../../src/logging/logger.ts';
import { startTestDatabase, type TestDatabase } from './support/test-database.ts';

// A database name that needs identifier quoting and a password that needs literal quoting:
// unsafe interpolation in the init script would fail to create the role or set a different password.
const DATABASE = 'Pheme-IT';
const APP_PASSWORD = `it's a "quoted"; \\secret $HOME`;
const INSUFFICIENT_PRIVILEGE = '42501';

const silentLogger = createLogger({ level: 'silent' });
let db: TestDatabase;

beforeAll(async () => {
  db = await startTestDatabase({ database: DATABASE, appPassword: APP_PASSWORD });
});

afterAll(async () => {
  await db?.container.stop();
});

async function withClient<T>(url: string, use: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 5_000 });
  await client.connect();
  try {
    return await use(client);
  } finally {
    await client.end();
  }
}

describe('pheme_app role created by the init script', () => {
  it('logs in with the quoted password and passes the SELECT 1 health check', async () => {
    const pool = createPool(
      { url: db.appUrl, connectTimeoutMs: 5_000, statementTimeoutMs: 5_000, poolMax: 1 },
      silentLogger,
    );
    try {
      await expect(checkDatabase(pool)).resolves.toEqual({ latencyMs: expect.any(Number) });
      const who = await pool.query('SELECT current_user AS role, current_database() AS database');
      expect(who.rows[0]).toEqual({ role: 'pheme_app', database: DATABASE });
    } finally {
      await pool.end();
    }
  });

  it('has no elevated role attributes', async () => {
    const attributes = await withClient(db.appUrl, async (client) => {
      const result = await client.query(
        `SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolconnlimit
           FROM pg_roles WHERE rolname = current_user`,
      );
      return result.rows[0];
    });
    expect(attributes).toEqual({
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolreplication: false,
      rolbypassrls: false,
      rolconnlimit: 20,
    });
  });

  it.each([
    ['create a table in schema public', 'CREATE TABLE public.probe (id integer)'],
    ['create a schema', 'CREATE SCHEMA probe'],
    ['create a temporary table', 'CREATE TEMP TABLE probe (id integer)'],
    ['create a role', 'CREATE ROLE probe'],
    ['create a database', 'CREATE DATABASE probe'],
  ])('is connected but cannot %s', async (_action, sql) => {
    await withClient(db.appUrl, async (client) => {
      // Proves the login itself worked, so the error below is a permission check, not a connection failure.
      const who = await client.query<{ role: string }>('SELECT current_user AS role');
      expect(who.rows[0]?.role).toBe('pheme_app');

      await expect(client.query(sql)).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
    });
  });

  it('does not let other login roles connect, because CONNECT was revoked from PUBLIC', async () => {
    await withClient(db.adminUrl, (client) =>
      client.query(`CREATE ROLE probe_login LOGIN PASSWORD 'probe-login-password'`),
    );
    const probe = new URL(db.adminUrl);
    probe.username = 'probe_login';
    probe.password = 'probe-login-password';

    await expect(withClient(probe.toString(), async () => {})).rejects.toMatchObject({
      code: INSUFFICIENT_PRIVILEGE,
    });
  });
});
