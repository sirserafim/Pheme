import { describe, expect, it } from 'vitest';
import { devEnvSchema } from '../../src/commands/dev.ts';
import { EnvValidationError, parseEnv } from '../../src/config/env.ts';

const SECRET = 'hunter2-not-a-real-password';
const VALID_URL = 'postgres://pheme_app:local-password@127.0.0.1:5432/pheme';

function captureEnvError(source: Record<string, string | undefined>): EnvValidationError {
  try {
    parseEnv('dev', devEnvSchema, source);
  } catch (error) {
    if (error instanceof EnvValidationError) return error;
    throw error;
  }
  throw new Error('expected parseEnv to throw');
}

describe('parseEnv for the dev command', () => {
  it('applies defaults for optional settings', () => {
    expect(parseEnv('dev', devEnvSchema, { DATABASE_URL: VALID_URL })).toEqual({
      DATABASE_URL: VALID_URL,
      LOG_LEVEL: 'info',
      DB_CONNECT_TIMEOUT_MS: 5_000,
      DB_STATEMENT_TIMEOUT_MS: 10_000,
      DB_POOL_MAX: 5,
    });
  });

  it('converts numeric strings and accepts explicit values', () => {
    const env = parseEnv('dev', devEnvSchema, {
      DATABASE_URL: VALID_URL,
      LOG_LEVEL: 'debug',
      DB_CONNECT_TIMEOUT_MS: '2500',
      DB_POOL_MAX: '2',
    });
    expect(env).toMatchObject({ LOG_LEVEL: 'debug', DB_CONNECT_TIMEOUT_MS: 2_500, DB_POOL_MAX: 2 });
  });

  it('treats empty values as unset', () => {
    const env = parseEnv('dev', devEnvSchema, { DATABASE_URL: VALID_URL, DB_POOL_MAX: '', LOG_LEVEL: '' });
    expect(env).toMatchObject({ DB_POOL_MAX: 5, LOG_LEVEL: 'info' });
  });

  it('returns only its own variables and needs no API keys', () => {
    const env = parseEnv('dev', devEnvSchema, {
      DATABASE_URL: VALID_URL,
      OPENAI_API_KEY: SECRET,
      PATH: '/usr/bin',
    });
    expect(Object.keys(env).sort()).toEqual([
      'DATABASE_URL',
      'DB_CONNECT_TIMEOUT_MS',
      'DB_POOL_MAX',
      'DB_STATEMENT_TIMEOUT_MS',
      'LOG_LEVEL',
    ]);
  });

  it('reports a missing DATABASE_URL by name, including when it is empty', () => {
    for (const source of [{}, { DATABASE_URL: '' }]) {
      const error = captureEnvError(source);
      expect(error.problems).toEqual([expect.objectContaining({ name: 'DATABASE_URL', reason: 'missing' })]);
      expect(error.message).toContain('DATABASE_URL is missing');
    }
  });

  it('reports every invalid variable by name without echoing the values', () => {
    const error = captureEnvError({
      DATABASE_URL: `http://pheme_app:${SECRET}@127.0.0.1/pheme`,
      DB_POOL_MAX: '999',
      DB_CONNECT_TIMEOUT_MS: 'soon',
      LOG_LEVEL: 'shouting',
    });

    expect(error.problems.map((p) => [p.name, p.reason]).sort()).toEqual([
      ['DATABASE_URL', 'invalid'],
      ['DB_CONNECT_TIMEOUT_MS', 'invalid'],
      ['DB_POOL_MAX', 'invalid'],
      ['LOG_LEVEL', 'invalid'],
    ]);
    const everything = `${error.message} ${error.stack ?? ''} ${JSON.stringify(error.problems)}`;
    for (const value of [SECRET, '999', 'soon', 'shouting']) expect(everything).not.toContain(value);
  });

  it('rejects a PostgreSQL URL without a host', () => {
    expect(captureEnvError({ DATABASE_URL: 'postgres:/pheme' }).problems[0]?.name).toBe('DATABASE_URL');
  });
});
