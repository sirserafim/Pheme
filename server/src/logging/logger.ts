import { randomUUID } from 'node:crypto';
import { type DestinationStream, type Logger, pino } from 'pino';
import type { LogLevel } from '../config/env.ts';
import { createScrubber, REDACTED } from './scrub.ts';
import { serializeError } from './serialize-error.ts';

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
 * Redaction has three layers: pino `redact` for named fields, an allowlisting error
 * serializer, and a scrubber over each finished line. The last layer is needed because pino
 * copies `err.message` into `msg` before serializers run, and messages are free text.
 */
export function createLogger(options: LoggerOptions): Logger {
  const scrub = createScrubber(options.secrets ?? []);
  const target = options.destination ?? pino.destination({ dest: 2, sync: true });
  const scrubbingDestination: DestinationStream = {
    write: (line) => target.write(scrub(line)),
  };

  return pino(
    {
      level: options.level,
      base: { service: 'pheme-server', runId: randomUUID() },
      redact: { paths: REDACT_PATHS, censor: REDACTED },
      serializers: { err: serializeError },
    },
    scrubbingDestination,
  );
}
