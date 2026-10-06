import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { runDev } from '../../src/commands/dev.ts';
import { captureLogs } from '../support/capture-logs.ts';

const SECRET = 'hunter2-not-a-real-password';

describe('runDev with an invalid environment', () => {
  it('exits with 1 before connecting and logs variable names, not values', async () => {
    const logs = captureLogs();
    const signals = new EventEmitter();

    const code = await runDev({
      env: { DATABASE_URL: `mysql://root:${SECRET}@127.0.0.1/pheme`, DB_POOL_MAX: '0' },
      signals,
      exit: () => {
        throw new Error('exit should not be called');
      },
      logDestination: logs.destination,
    });

    expect(code).toBe(1);
    expect(logs.text()).toContain('DATABASE_URL is invalid');
    expect(logs.text()).toContain('DB_POOL_MAX is invalid');
    expect(logs.text()).not.toContain(SECRET);
    expect(logs.records().map((r) => r.msg)).not.toContain('dev starting');
    expect(signals.listenerCount('SIGINT')).toBe(0);
  });

  it('exits with 1 for a malformed percent escape instead of throwing URIError', async () => {
    const logs = captureLogs();
    const signals = new EventEmitter();

    const code = await runDev({
      env: { DATABASE_URL: 'postgres://%FF:synthetic-password@127.0.0.1/pheme' },
      signals,
      exit: () => {
        throw new Error('exit should not be called');
      },
      logDestination: logs.destination,
    });

    expect(code).toBe(1);
    const [record] = logs.records();
    expect(record).toMatchObject({ level: 50, problems: [{ name: 'DATABASE_URL', reason: 'invalid' }] });
    expect(logs.text()).not.toContain('synthetic-password');
    expect(logs.text()).not.toContain('%FF');
    expect(logs.text()).not.toContain('URIError');
    expect(logs.records().map((r) => r.msg)).not.toContain('dev starting');
    expect(signals.listenerCount('SIGINT')).toBe(0);
  });

  it('does not turn an unexpected error into a configuration error', async () => {
    const failure = new TypeError('environment source is broken');
    const env = new Proxy(
      {},
      {
        ownKeys: () => {
          throw failure;
        },
      },
    );

    await expect(runDev({ env, signals: new EventEmitter(), exit: () => undefined })).rejects.toBe(failure);
  });
});
