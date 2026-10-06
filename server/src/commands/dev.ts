import type { DestinationStream } from 'pino';
import { z } from 'zod';
import { databaseEnvSchema, EnvValidationError, logEnvSchema, parseEnv } from '../config/env.ts';
import { checkDatabase, type HealthResult } from '../db/health.ts';
import { createPool, type DatabaseConfig, describeDatabase, trackConnections } from '../db/pool.ts';
import { runWithTimeout, type SignalSource, waitForShutdown } from '../lifecycle/shutdown.ts';
import { createLogger, type Logger } from '../logging/logger.ts';
import { secretsFromDatabaseUrl } from '../logging/scrub.ts';

/** `dev` needs logging and database settings only; no API or LLM keys. */
export const devEnvSchema = z.object({ ...logEnvSchema.shape, ...databaseEnvSchema.shape });

const SHUTDOWN_TIMEOUT_MS = 10_000;

/** What `dev` needs from the database; tests replace the pg pool with a fake. */
export interface DevDatabase {
  check(): Promise<HealthResult>;
  close(): Promise<void>;
  /** Cancels leftover sockets. Called when close() fails or passes its deadline. */
  abandon(): void;
}

export interface DevDependencies {
  env: Readonly<Record<string, string | undefined>>;
  signals: SignalSource;
  /**
   * Ends the process at once. Called when shutdown cannot finish cleanly: a second signal, or
   * closing the pool failed or passed its deadline. In those cases open sockets may still keep
   * the event loop alive, so returning an exit code alone would not end the process.
   */
  exit: (code: number) => void;
  logDestination?: DestinationStream | undefined;
  openDatabase?: ((config: DatabaseConfig, logger: Logger) => DevDatabase) | undefined;
  shutdownTimeoutMs?: number | undefined;
}

/**
 * Validates the environment, checks the database once, then waits for SIGINT/SIGTERM and
 * closes the pool. Returns 0 after a clean shutdown and 1 otherwise; "shutdown complete" is
 * logged only when the pool closed and no forced exit was requested.
 */
export async function runDev(deps: DevDependencies): Promise<number> {
  const env = parseDevEnv(deps);
  if (env === undefined) return 1;

  const logger = createLogger({
    level: env.LOG_LEVEL,
    secrets: secretsFromDatabaseUrl(env.DATABASE_URL),
    destination: deps.logDestination,
  });
  const target = describeDatabase(env.DATABASE_URL);
  const timeoutMs = deps.shutdownTimeoutMs ?? SHUTDOWN_TIMEOUT_MS;
  logger.info({ node: process.version, pid: process.pid, db: target }, 'dev starting');

  let forced = false;
  const forceExit = () => {
    if (forced) return;
    forced = true;
    deps.exit(1);
  };
  const shutdown = waitForShutdown(deps.signals, (signal) => {
    logger.warn({ signal }, 'second signal received, forcing exit');
    forceExit();
  });

  try {
    const database = (deps.openDatabase ?? openPgDatabase)(
      {
        url: env.DATABASE_URL,
        connectTimeoutMs: env.DB_CONNECT_TIMEOUT_MS,
        statementTimeoutMs: env.DB_STATEMENT_TIMEOUT_MS,
        poolMax: env.DB_POOL_MAX,
      },
      logger,
    );

    try {
      const { latencyMs } = await database.check();
      logger.info({ db: target, latencyMs }, 'db ok');
    } catch (err) {
      logger.error({ err, db: target }, 'db check failed');
      if (!(await closeDatabase(database, logger, timeoutMs))) forceExit();
      return 1;
    }

    const signal = await shutdown.received;
    logger.info({ signal }, 'shutdown requested');
    if (!(await closeDatabase(database, logger, timeoutMs))) {
      forceExit();
      return 1;
    }
    if (forced) return 1;
    logger.info('shutdown complete');
    return 0;
  } finally {
    shutdown.dispose();
  }
}

function parseDevEnv(deps: DevDependencies): z.output<typeof devEnvSchema> | undefined {
  try {
    return parseEnv('dev', devEnvSchema, deps.env);
  } catch (error) {
    if (!(error instanceof EnvValidationError)) throw error;
    const rawUrl = deps.env.DATABASE_URL;
    const logger = createLogger({
      level: 'info',
      secrets: rawUrl === undefined ? [] : secretsFromDatabaseUrl(rawUrl),
      destination: deps.logDestination,
    });
    logger.error({ problems: error.problems }, error.message);
    return undefined;
  }
}

function openPgDatabase(config: DatabaseConfig, logger: Logger): DevDatabase {
  const pool = createPool(config, logger);
  const connections = trackConnections(pool);
  return {
    check: () => checkDatabase(pool),
    close: async () => {
      await pool.end();
      await connections.allClosed();
    },
    abandon: () => connections.abandon(),
  };
}

/** Returns true only if the pool closed before the deadline. */
async function closeDatabase(database: DevDatabase, logger: Logger, timeoutMs: number): Promise<boolean> {
  const outcome = await runWithTimeout(() => database.close(), timeoutMs);
  if (outcome.status === 'failed') logger.error({ err: outcome.error }, 'closing database pool failed');
  if (outcome.status === 'timeout') logger.error({ timeoutMs }, 'closing database pool timed out');
  // Waiting stopped; the close() task itself did not. Destroy leftover sockets so they cannot
  // keep the process alive after the deadline.
  if (outcome.status !== 'done') database.abandon();
  return outcome.status === 'done';
}
