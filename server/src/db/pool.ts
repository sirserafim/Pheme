import { Pool } from 'pg';
import type { Logger } from '../logging/logger.ts';

export interface DatabaseConfig {
  url: string;
  connectTimeoutMs: number;
  statementTimeoutMs: number;
  poolMax: number;
}

/** Fields that identify a database in logs without revealing the password. */
export interface DatabaseTarget {
  host: string;
  port: number;
  database: string;
  user: string;
}

const DEFAULT_PORT = 5432;
// Gives the server's statement_timeout the first chance to cancel and report the query;
// the client-side query_timeout only fires if the server or network stops responding.
const CLIENT_TIMEOUT_MARGIN_MS = 1_000;

export function createPool(config: DatabaseConfig, logger: Logger): Pool {
  const pool = new Pool({
    connectionString: config.url,
    max: config.poolMax,
    connectionTimeoutMillis: config.connectTimeoutMs,
    statement_timeout: config.statementTimeoutMs,
    query_timeout: config.statementTimeoutMs + CLIENT_TIMEOUT_MARGIN_MS,
    idleTimeoutMillis: 10_000,
    application_name: 'pheme-server',
  });
  // Without a listener, an error on an idle client (for example a database restart) would be
  // an unhandled 'error' event and crash the process.
  pool.on('error', (err) => {
    logger.error({ err }, 'idle database client error');
  });
  return pool;
}

/**
 * Decodes the components the way pg-connection-string does, so the log shows the database pg
 * actually connects to. Expects a URL that already passed databaseEnvSchema; anything else
 * throwing here is a programming error.
 */
export function describeDatabase(url: string): DatabaseTarget {
  const parsed = new URL(url);
  return {
    host: decodeURIComponent(parsed.hostname),
    port: parsed.port === '' ? DEFAULT_PORT : Number(parsed.port),
    database: decodeURI(parsed.pathname.slice(1)),
    user: decodeURIComponent(parsed.username),
  };
}
