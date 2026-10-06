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

/** A connected pg client, or a test double. `connection.stream` is the TCP socket. */
export interface TrackedClient {
  once(event: 'end', listener: () => void): unknown;
  connection?: { stream?: { destroy(): void } };
}

/** The part of a pg Pool that trackConnections() listens to; tests pass an EventEmitter. */
export interface ConnectionEvents {
  on(event: 'connect', listener: (client: TrackedClient) => void): unknown;
}

export interface TrackedConnections {
  allClosed(): Promise<void>;
  /** Destroys leftover sockets. A timeout race does not do this by itself. */
  abandon(): void;
}

/**
 * pool.end() resolves as soon as the pool has dropped its clients, but each socket closes later,
 * and never if the server stops answering; an open socket keeps the process alive. This records
 * every connection the pool opens, so shutdown can wait until all of them have really closed
 * and, if the deadline expires, destroy the ones that have not.
 */
export function trackConnections(pool: ConnectionEvents): TrackedConnections {
  const open = new Set<TrackedClient>();
  const waiting: (() => void)[] = [];
  const notifyIfIdle = () => {
    if (open.size === 0) for (const resolve of waiting.splice(0)) resolve();
  };
  pool.on('connect', (client) => {
    open.add(client);
    client.once('end', () => {
      open.delete(client);
      notifyIfIdle();
    });
  });
  return {
    allClosed: () =>
      open.size === 0
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            waiting.push(resolve);
          }),
    abandon: () => {
      for (const client of [...open]) client.connection?.stream?.destroy();
    },
  };
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
