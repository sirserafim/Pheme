import { describe, expect, it } from 'vitest';
import { createLogger } from '../../src/logging/logger.ts';
import { REDACTED, secretsFromDatabaseUrl } from '../../src/logging/scrub.ts';
import { captureLogs } from '../support/capture-logs.ts';

const PASSWORD = 'p@ss word/with:specials';
const ENCODED_PASSWORD = encodeURIComponent(PASSWORD);
const DATABASE_URL = `postgres://pheme_app:${ENCODED_PASSWORD}@127.0.0.1:5432/pheme`;

function loggerWithDatabaseSecrets() {
  const logs = captureLogs();
  const logger = createLogger({
    level: 'info',
    secrets: secretsFromDatabaseUrl(DATABASE_URL),
    destination: logs.destination,
  });
  return { logger, logs };
}

function expectNoSecrets(text: string) {
  expect(text).not.toContain(PASSWORD);
  expect(text).not.toContain(ENCODED_PASSWORD);
  expect(text).not.toContain(DATABASE_URL);
}

describe('createLogger redaction', () => {
  it('redacts secret-named fields at the top level and one level deep', () => {
    const { logger, logs } = loggerWithDatabaseSecrets();
    logger.info(
      {
        password: 'top-level-value',
        DATABASE_URL,
        db: { password: 'nested-value', connectionString: DATABASE_URL },
        headers: { authorization: 'Bearer token-value' },
      },
      'configuration loaded',
    );

    const [record] = logs.records();
    expect(record).toMatchObject({
      password: REDACTED,
      DATABASE_URL: REDACTED,
      db: { password: REDACTED, connectionString: REDACTED },
      headers: { authorization: REDACTED },
    });
    for (const value of ['top-level-value', 'nested-value', 'token-value']) {
      expect(logs.text()).not.toContain(value);
    }
  });

  it('removes secrets from error message, stack and cause', () => {
    const { logger, logs } = loggerWithDatabaseSecrets();
    const cause = new Error(`password authentication failed for password "${PASSWORD}"`);
    const error = new Error(`could not connect to ${DATABASE_URL}`, { cause });

    logger.error({ err: error }, 'db check failed');
    // pino copies err.message into msg when no message is given, before serializers run.
    logger.error(error);

    const text = logs.text();
    expectNoSecrets(text);
    const [withMessage, withoutMessage] = logs.records();
    expect(withMessage?.err?.message).toContain(REDACTED);
    expect(withMessage?.err?.stack).toContain(REDACTED);
    expect(withMessage?.err?.cause?.message).toContain(REDACTED);
    expect(withoutMessage?.msg).toContain(REDACTED);
  });

  it('removes secrets from errors inside an AggregateError', () => {
    const { logger, logs } = loggerWithDatabaseSecrets();
    const error = new AggregateError(
      [new Error(`connect ECONNREFUSED ${DATABASE_URL}`)],
      'all attempts failed',
    );

    logger.error({ err: error }, 'db check failed');

    expectNoSecrets(logs.text());
    expect(logs.records()[0]?.err?.errors?.[0]?.message).toContain(REDACTED);
  });

  it('masks passwords in URLs that were never registered as secrets', () => {
    const logs = captureLogs();
    const logger = createLogger({ level: 'info', destination: logs.destination });

    logger.warn(`retrying postgresql://someone:unregistered-pass@db.example:5432/x`);
    logger.error({ err: new Error('failed: https://user:another-pass@api.example/v1') }, 'request failed');

    const text = logs.text();
    expect(text).not.toContain('unregistered-pass');
    expect(text).not.toContain('another-pass');
    expect(text).toContain(`postgresql://someone:${REDACTED}@db.example:5432/x`);
  });

  it('logs only allowlisted error fields', () => {
    const { logger, logs } = loggerWithDatabaseSecrets();
    const error = Object.assign(new Error('invalid input syntax'), {
      code: '22P02',
      detail: 'Key (email)=(someone@example.com) already exists.',
      input: DATABASE_URL,
    });

    logger.error({ err: error }, 'query failed');

    const err = logs.records()[0]?.err ?? {};
    expect(Object.keys(err).sort()).toEqual(['code', 'message', 'stack', 'type']);
    expect(logs.text()).not.toContain('someone@example.com');
  });

  it('tags every line with the service and a run id', () => {
    const logs = captureLogs();
    const logger = createLogger({ level: 'info', destination: logs.destination });
    logger.info('first');
    logger.info('second');

    const [first, second] = logs.records();
    expect(first).toMatchObject({ service: 'pheme-server', runId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(second?.runId).toBe(first?.runId);
  });
});
