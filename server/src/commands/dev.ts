import type { Pool } from 'pg';
import type { DestinationStream } from 'pino';
import { z } from 'zod';
import { databaseEnvSchema, EnvValidationError, logEnvSchema, parseEnv } from '../config/env.ts';
import { checkDatabase } from '../db/health.ts';
import { createPool, describeDatabase } from '../db/pool.ts';
import { runWithTimeout, type SignalSource, waitForShutdown } from '../lifecycle/shutdown.ts';
import { createLogger, type Logger } from '../logging/logger.ts';
import { secretsFromDatabaseUrl } from '../logging/scrub.ts';

/** `dev` needs logging and database settings only; no API or LLM keys. */
export const devEnvSchema = z.object({ ...logEnvSchema.shape, ...databaseEnvSchema.shape });

const SHUTDOWN_TIMEOUT_MS = 10_000;

export interface DevDependencies {
  env: Readonly<Record<string, string | undefined>>;
  signals: SignalSource;
  /** Called when a second signal arrives while shutting down. */
  exit: (code: number) => void;
  logDestination?: DestinationStream | undefined;
}

/**
 * Validates the environment, checks the database once, then waits for SIGINT/SIGTERM and
 * closes the pool. Returns the process exit code: 0 after a clean shutdown, 1 otherwise.
 */
export async function runDev(deps: DevDependencies): Promise<number> {
  let env: z.output<typeof devEnvSchema>;
  try {
    env = parseEnv('dev', devEnvSchema, deps.env);
  } catch (error) {
    if (!(error instanceof EnvValidationError)) throw error;
    const rawUrl = deps.env.DATABASE_URL;
    const logger = createLogger({
      level: 'info',
      secrets: rawUrl === undefined ? [] : secretsFromDatabaseUrl(rawUrl),
      destination: deps.logDestination,
    });
    logger.error({ problems: error.problems }, error.message);
    return 1;
  }

  const logger = createLogger({
    level: env.LOG_LEVEL,
    secrets: secretsFromDatabaseUrl(env.DATABASE_URL),
    destination: deps.logDestination,
  });
  const target = describeDatabase(env.DATABASE_URL);
  logger.info({ node: process.version, pid: process.pid, db: target }, 'dev starting');

  const shutdown = waitForShutdown(deps.signals, (signal) => {
    logger.warn({ signal }, 'second signal received, forcing exit');
    deps.exit(1);
  });
  const pool = createPool(
    {
      url: env.DATABASE_URL,
      connectTimeoutMs: env.DB_CONNECT_TIMEOUT_MS,
      statementTimeoutMs: env.DB_STATEMENT_TIMEOUT_MS,
      poolMax: env.DB_POOL_MAX,
    },
    logger,
  );

  try {
    const { latencyMs } = await checkDatabase(pool);
    logger.info({ db: target, latencyMs }, 'db ok');
  } catch (err) {
    logger.error({ err, db: target }, 'db check failed');
    shutdown.dispose();
    await closePool(pool, logger);
    return 1;
  }

  const signal = await shutdown.received;
  logger.info({ signal }, 'shutdown requested');
  const closed = await closePool(pool, logger);
  shutdown.dispose();
  if (closed) logger.info('shutdown complete');
  return closed ? 0 : 1;
}

async function closePool(pool: Pool, logger: Logger): Promise<boolean> {
  const outcome = await runWithTimeout(() => pool.end(), SHUTDOWN_TIMEOUT_MS);
  if (outcome.status === 'failed') logger.error({ err: outcome.error }, 'closing database pool failed');
  if (outcome.status === 'timeout') {
    logger.error({ timeoutMs: SHUTDOWN_TIMEOUT_MS }, 'closing database pool timed out');
  }
  return outcome.status === 'done';
}
