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
});
