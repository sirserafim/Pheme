import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { type DevDatabase, runDev } from '../../src/commands/dev.ts';
import type { HealthResult } from '../../src/db/health.ts';
import { captureLogs } from '../support/capture-logs.ts';
import { countOccurrences } from '../support/secrets.ts';

const SECRET = 'hunter2-not-a-real-password';
const VALID_ENV = { DATABASE_URL: 'postgres://pheme_app:synthetic-password@127.0.0.1:5432/pheme' };

interface FakeDatabaseOptions {
  check?: () => Promise<HealthResult>;
  close?: () => Promise<void>;
  abandon?: () => void;
}

function fakeDatabase(options: FakeDatabaseOptions = {}) {
  const calls = { check: 0, close: 0, abandon: 0 };
  const database: DevDatabase = {
    check: () => {
      calls.check++;
      return options.check?.() ?? Promise.resolve({ latencyMs: 1 });
    },
    close: () => {
      calls.close++;
      return options.close?.() ?? Promise.resolve();
    },
    abandon: () => {
      calls.abandon++;
      options.abandon?.();
    },
  };
  return { database, calls };
}

/** Starts runDev with a fake database; `exit` only records the call and returns. */
function startDev(
  database: DevDatabase,
  options: { env?: Record<string, string>; shutdownTimeoutMs?: number } = {},
) {
  const logs = captureLogs();
  const signals = new EventEmitter();
  const exit = vi.fn<(code: number) => void>();
  const result = runDev({
    env: { ...VALID_ENV, ...options.env },
    signals,
    exit,
    logDestination: logs.destination,
    openDatabase: () => database,
    shutdownTimeoutMs: options.shutdownTimeoutMs,
  });
  const messages = () => logs.records().map((record) => record.msg);
  const waitForMessage = (msg: string) => vi.waitFor(() => expect(messages()).toContain(msg));
  return { logs, signals, exit, result, messages, waitForMessage };
}

function expectNoSignalListeners(signals: EventEmitter) {
  expect(signals.listenerCount('SIGINT')).toBe(0);
  expect(signals.listenerCount('SIGTERM')).toBe(0);
}

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

describe('runDev shutdown', () => {
  it('closes the pool, logs completion and returns 0 after one signal', async () => {
    const { database, calls } = fakeDatabase();
    const dev = startDev(database);

    await dev.waitForMessage('db ok');
    dev.signals.emit('SIGINT', 'SIGINT');

    await expect(dev.result).resolves.toBe(0);
    expect(dev.messages()).toEqual(['dev starting', 'db ok', 'shutdown requested', 'shutdown complete']);
    expect(calls.close).toBe(1);
    expect(calls.abandon).toBe(0);
    expect(dev.exit).not.toHaveBeenCalled();
    expectNoSignalListeners(dev.signals);
  });

  it('returns 0 without any log line when LOG_LEVEL hides info messages', async () => {
    const { database, calls } = fakeDatabase();
    const dev = startDev(database, { env: { LOG_LEVEL: 'warn' } });

    dev.signals.emit('SIGTERM', 'SIGTERM');

    await expect(dev.result).resolves.toBe(0);
    expect(dev.logs.text()).toBe('');
    expect(calls.close).toBe(1);
    expect(dev.exit).not.toHaveBeenCalled();
  });

  it('forces exit 1 and reports no success when closing the pool fails', async () => {
    const { database, calls } = fakeDatabase({
      close: () => Promise.reject(new Error('synthetic close failure for synthetic-password')),
    });
    const dev = startDev(database);

    await dev.waitForMessage('db ok');
    dev.signals.emit('SIGINT', 'SIGINT');

    await expect(dev.result).resolves.toBe(1);
    expect(dev.exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(dev.messages()).toEqual([
      'dev starting',
      'db ok',
      'shutdown requested',
      'closing database pool failed',
    ]);
    expect(countOccurrences(dev.logs.text(), 'synthetic-password')).toBe(0);
    expect(calls.abandon).toBe(1);
    expectNoSignalListeners(dev.signals);
  });

  it('forces exit 1 at the deadline when closing the pool hangs', async () => {
    const { database, calls } = fakeDatabase({ close: () => new Promise<void>(() => {}) });
    const dev = startDev(database, { shutdownTimeoutMs: 50 });

    await dev.waitForMessage('db ok');
    const interruptedAt = performance.now();
    dev.signals.emit('SIGINT', 'SIGINT');

    await expect(dev.result).resolves.toBe(1);
    expect(performance.now() - interruptedAt).toBeLessThan(2_000);
    expect(dev.exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(dev.logs.records().at(-1)).toMatchObject({
      msg: 'closing database pool timed out',
      timeoutMs: 50,
    });
    expect(dev.messages()).not.toContain('shutdown complete');
    expect(calls.abandon).toBe(1);
    expectNoSignalListeners(dev.signals);
  });

  it('forces exit 1 on a repeated signal and does not report success when closing finishes later', async () => {
    let finishClose = () => {};
    const { database } = fakeDatabase({
      close: () =>
        new Promise<void>((resolve) => {
          finishClose = resolve;
        }),
    });
    const dev = startDev(database);

    await dev.waitForMessage('db ok');
    dev.signals.emit('SIGINT', 'SIGINT');
    await dev.waitForMessage('shutdown requested');
    dev.signals.emit('SIGINT', 'SIGINT');
    dev.signals.emit('SIGTERM', 'SIGTERM');
    finishClose();

    await expect(dev.result).resolves.toBe(1);
    expect(dev.exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(dev.messages()).not.toContain('shutdown complete');
    expect(dev.messages().filter((msg) => msg === 'second signal received, forcing exit')).toHaveLength(2);
    expectNoSignalListeners(dev.signals);
  });

  it('closes the pool and returns 1 without forcing exit when the database check fails', async () => {
    const { database, calls } = fakeDatabase({
      check: () => Promise.reject(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })),
    });
    const dev = startDev(database);

    await expect(dev.result).resolves.toBe(1);
    expect(dev.messages()).toEqual(['dev starting', 'db check failed']);
    expect(calls.close).toBe(1);
    expect(dev.exit).not.toHaveBeenCalled();
    expectNoSignalListeners(dev.signals);
  });

  it('forces exit 1 when both the database check and closing the pool fail', async () => {
    const { database, calls } = fakeDatabase({
      check: () => Promise.reject(new Error('synthetic check failure')),
      close: () => Promise.reject(new Error('synthetic close failure')),
    });
    const dev = startDev(database);

    await expect(dev.result).resolves.toBe(1);
    expect(dev.exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(dev.messages()).toEqual(['dev starting', 'db check failed', 'closing database pool failed']);
    expect(calls.abandon).toBe(1);
    expectNoSignalListeners(dev.signals);
  });

  it('removes its listeners and rethrows a programming error from opening the database', async () => {
    const bug = new TypeError('synthetic programming error');
    const signals = new EventEmitter();
    const exit = vi.fn<(code: number) => void>();

    const result = runDev({
      env: VALID_ENV,
      signals,
      exit,
      logDestination: captureLogs().destination,
      openDatabase: () => {
        throw bug;
      },
    });

    await expect(result).rejects.toBe(bug);
    expect(exit).not.toHaveBeenCalled();
    expectNoSignalListeners(signals);
  });
});
