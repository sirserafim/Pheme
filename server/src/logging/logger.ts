import { randomUUID } from 'node:crypto';
import { type DestinationStream, type LogFn, type Logger, pino } from 'pino';
import type { LogLevel } from '../config/env.ts';
import { sanitizeLogArguments } from './sanitize.ts';
import { createScrubber, REDACTED } from './scrub.ts';

export type { Logger } from 'pino';

const SECRET_KEYS = [
  'password',
  'connectionString',
  'databaseUrl',
  'DATABASE_URL',
  'apiKey',
  'token',
  'secret',
  'authorization',
  'cookie',
];

/** Structured fields redacted by name, at the top level and one level deep. */
export const REDACT_PATHS = [...SECRET_KEYS, ...SECRET_KEYS.map((key) => `*.${key}`)];

export interface LoggerOptions {
  level: LogLevel;
  /** Known secret values (for example the database URL) removed from every log line. */
  secrets?: readonly string[];
  /** Defaults to stderr, so stdout stays free for command output and MCP stdio. */
  destination?: DestinationStream | undefined;
}

/**
 * Every argument of a log call is sanitized before pino serializes it: errors keep only
 * allowlisted fields, and known secrets and URL passwords are removed from every string value,
 * including the message pino copies from `err.message`. pino's `redact` then censors fields with
 * secret names. Working on values instead of the finished JSON line keeps the output valid JSON
 * and leaves numbers and the `service`/`runId` bindings, which the program sets, unchanged.
 */
export function createLogger(options: LoggerOptions): Logger {
  const scrub = createScrubber(options.secrets ?? []);
  return pino(
    {
      level: options.level,
      base: { service: 'pheme-server', runId: randomUUID() },
      redact: { paths: REDACT_PATHS, censor: REDACTED },
      // Errors arrive here already allowlisted and scrubbed. This replaces pino's default err
      // serializer, which would copy every enumerable property again.
      serializers: { err: (value: unknown) => value },
      hooks: {
        logMethod(args, method) {
          method.apply(this, sanitizeLogArguments(args, scrub) as Parameters<LogFn>);
        },
      },
    },
    options.destination ?? pino.destination({ dest: 2, sync: true }),
  );
}
