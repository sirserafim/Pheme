import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '../../src/logging/logger.ts';
import { REDACTED, secretsFromDatabaseUrl } from '../../src/logging/scrub.ts';
import { captureLogs, type LogRecord } from '../support/capture-logs.ts';

const SERVER_DIR = fileURLToPath(new URL('../..', import.meta.url));
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Synthetic credentials only.
const PASSWORD = 'p@ss word/with:specials';
const ENCODED_PASSWORD = encodeURIComponent(PASSWORD);
const DATABASE_URL = `postgres://pheme_app:${ENCODED_PASSWORD}@127.0.0.1:5432/pheme`;

function loggerWith(secrets: readonly string[]) {
  const logs = captureLogs();
  const logger = createLogger({ level: 'info', secrets, destination: logs.destination });
  return { logger, logs };
}

/** Parses every line as JSON and checks the metadata that redaction must never touch. */
function parsedRecords(logs: ReturnType<typeof captureLogs>): LogRecord[] {
  const records = logs.records();
  for (const record of records) {
    expect(record).toMatchObject({
      level: expect.any(Number),
      time: expect.any(Number),
      service: 'pheme-server',
      runId: expect.stringMatching(UUID_V4),
    });
  }
  return records;
}

function countOccurrences(text: string, value: string): number {
  return text.split(value).length - 1;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createLogger redaction', () => {
  it('redacts secret-named fields at the top level and one level deep', () => {
    const { logger, logs } = loggerWith(secretsFromDatabaseUrl(DATABASE_URL));
    logger.info(
      {
        password: 'top-level-value',
        DATABASE_URL,
        db: { password: 'nested-value', connectionString: DATABASE_URL },
        headers: { authorization: 'Bearer token-value' },
      },
      'configuration loaded',
    );

    const [record] = parsedRecords(logs);
    expect(record).toMatchObject({
      password: REDACTED,
      DATABASE_URL: REDACTED,
      db: { password: REDACTED, connectionString: REDACTED },
      headers: { authorization: REDACTED },
    });
    for (const value of ['top-level-value', 'nested-value', 'token-value']) {
      expect(countOccurrences(logs.text(), value)).toBe(0);
    }
  });

  it('removes secrets from error message, stack and cause, and from the automatic msg', () => {
    const { logger, logs } = loggerWith(secretsFromDatabaseUrl(DATABASE_URL));
    const cause = new Error(`password authentication failed for password "${PASSWORD}"`);
    const error = new Error(`could not connect to ${DATABASE_URL}`, { cause });

    logger.error({ err: error }, 'db check failed');
    // Without a message argument pino copies err.message into msg.
    logger.error(error);
    logger.error({ err: error });

    for (const value of [PASSWORD, ENCODED_PASSWORD, DATABASE_URL]) {
      expect(countOccurrences(logs.text(), value)).toBe(0);
    }
    const [withMessage, bareError, errorField] = parsedRecords(logs);
    expect(withMessage?.msg).toBe('db check failed');
    expect(withMessage?.err?.message).toContain(REDACTED);
    expect(withMessage?.err?.stack).toContain(REDACTED);
    expect(withMessage?.err?.cause?.message).toContain(REDACTED);
    expect(bareError?.msg).toBe(`could not connect to ${REDACTED}`);
    expect(errorField?.msg).toBe(`could not connect to ${REDACTED}`);
  });

  it('removes secrets from errors inside an AggregateError', () => {
    const { logger, logs } = loggerWith(secretsFromDatabaseUrl(DATABASE_URL));
    const error = new AggregateError(
      [new Error(`connect ECONNREFUSED ${DATABASE_URL}`)],
      'all attempts failed',
    );

    logger.error({ err: error }, 'db check failed');

    expect(countOccurrences(logs.text(), DATABASE_URL)).toBe(0);
    expect(parsedRecords(logs)[0]?.err?.errors?.[0]?.message).toBe(`connect ECONNREFUSED ${REDACTED}`);
  });

  it('redacts a short registered password from message, stack and automatic msg', () => {
    const { logger, logs } = loggerWith(secretsFromDatabaseUrl('postgres://app:abc1234@127.0.0.1/pheme'));

    logger.error(new Error('example boundary included abc1234'));

    expect(countOccurrences(logs.text(), 'abc1234')).toBe(0);
    const [record] = parsedRecords(logs);
    expect(record?.msg).toBe(`example boundary included ${REDACTED}`);
    expect(record?.err?.message).toBe(`example boundary included ${REDACTED}`);
    expect(record?.err?.stack).toContain(`example boundary included ${REDACTED}`);
  });

  it('keeps valid JSON and numeric fields when a numeric password matches the timestamp', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1791245000000);
    const { logger, logs } = loggerWith(['17912450']);

    logger.info('startup');
    logger.info({ latencyMs: 17912450, port: 5432 }, 'numbers are not secrets');
    logger.info('password 17912450 appeared in text');

    const [startup, numbers, text] = parsedRecords(logs);
    expect(startup).toMatchObject({ time: 1791245000000, msg: 'startup' });
    expect(numbers).toMatchObject({ time: 1791245000000, latencyMs: 17912450, port: 5432 });
    expect(text?.msg).toBe(`password ${REDACTED} appeared in text`);
  });

  it('keeps service and runId when a one-character secret also occurs in them', () => {
    // Every version 4 UUID contains "4", so a scrubbed runId would be detected.
    const { logger, logs } = loggerWith(['4']);

    logger.info('listening on port 5432');

    const [record] = parsedRecords(logs);
    expect(record?.msg).toBe(`listening on port 5${REDACTED}32`);
  });

  it('removes raw, JSON-escaped and percent-encoded forms of a password with special characters', () => {
    const password = 'q"7\\x\n%';
    const { logger, logs } = loggerWith(
      secretsFromDatabaseUrl(`postgres://app:${encodeURIComponent(password)}@127.0.0.1/pheme`),
    );

    logger.warn(`raw ${password} end`);
    logger.warn(`body {"password":${JSON.stringify(password)}} end`);
    logger.error({ err: new Error(`url-encoded ${encodeURIComponent(password)} end`) }, 'request failed');

    const text = logs.text();
    for (const form of [password, JSON.stringify(password).slice(1, -1), encodeURIComponent(password)]) {
      expect(countOccurrences(text, form)).toBe(0);
    }
    const [raw, body, encoded] = parsedRecords(logs);
    expect(raw?.msg).toBe(`raw ${REDACTED} end`);
    expect(body?.msg).toBe(`body {"password":"${REDACTED}"} end`);
    expect(encoded?.err?.message).toBe(`url-encoded ${REDACTED} end`);
  });

  it('scrubs format arguments, including a secret split across them', () => {
    const { logger, logs } = loggerWith(['abc1234']);

    logger.info('connecting with %s', 'abc1234');
    logger.info('abc%s', '1234');

    expect(countOccurrences(logs.text(), 'abc1234')).toBe(0);
    expect(parsedRecords(logs).map((r) => r.msg)).toEqual([`connecting with ${REDACTED}`, REDACTED]);
  });

  it('replaces a secret that contains another secret as a whole', () => {
    const { logger, logs } = loggerWith(['abc', 'abc1234']);

    logger.info('value abc1234 and abc');

    expect(parsedRecords(logs)[0]?.msg).toBe(`value ${REDACTED} and ${REDACTED}`);
  });

  it('masks passwords in URLs that were never registered as secrets', () => {
    const logs = captureLogs();
    const logger = createLogger({ level: 'info', destination: logs.destination });

    logger.warn('retrying postgresql://someone:unregistered-pass@db.example:5432/x');
    logger.error({ err: new Error('failed: https://user:another-pass@api.example/v1') }, 'request failed');

    const text = logs.text();
    expect(countOccurrences(text, 'unregistered-pass')).toBe(0);
    expect(countOccurrences(text, 'another-pass')).toBe(0);
    expect(parsedRecords(logs)[0]?.msg).toBe(`retrying postgresql://someone:${REDACTED}@db.example:5432/x`);
  });

  it('logs only allowlisted error fields', () => {
    const { logger, logs } = loggerWith(secretsFromDatabaseUrl(DATABASE_URL));
    const error = Object.assign(new Error('invalid input syntax'), {
      code: '22P02',
      detail: 'Key (email)=(someone@example.com) already exists.',
      input: DATABASE_URL,
    });

    logger.error({ err: error }, 'query failed');

    const err = parsedRecords(logs)[0]?.err ?? {};
    expect(Object.keys(err).sort()).toEqual(['code', 'message', 'stack', 'type']);
    expect(countOccurrences(logs.text(), 'someone@example.com')).toBe(0);
  });

  it('tags every line with the service and the same run id', () => {
    const { logger, logs } = loggerWith([]);
    logger.info('first');
    logger.info('second');

    const [first, second] = parsedRecords(logs);
    expect(second?.runId).toBe(first?.runId);
  });
});

describe('createLogger output', () => {
  it('keeps the configured level', () => {
    const logs = captureLogs();
    const logger = createLogger({ level: 'warn', destination: logs.destination });

    logger.info('dropped');
    logger.warn('kept');

    expect(logger.level).toBe('warn');
    expect(parsedRecords(logs).map((r) => r.msg)).toEqual(['kept']);
  });

  it('writes to stderr by default and leaves stdout empty', async () => {
    const script =
      "const { createLogger } = await import('./src/logging/logger.ts'); createLogger({ level: 'info' }).info('to stderr');";
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', script], {
      cwd: SERVER_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    const [code] = await once(child, 'close');

    expect(code).toBe(0);
    expect(stdout).toBe('');
    expect(JSON.parse(stderr)).toMatchObject({ msg: 'to stderr', service: 'pheme-server' });
  });
});
