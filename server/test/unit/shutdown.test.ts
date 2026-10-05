import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { runWithTimeout, waitForShutdown } from '../../src/lifecycle/shutdown.ts';

describe('waitForShutdown', () => {
  it('resolves with the first signal and reports later signals as repeats', async () => {
    const source = new EventEmitter();
    const repeats: string[] = [];
    const waiter = waitForShutdown(source, (signal) => repeats.push(signal));

    source.emit('SIGTERM', 'SIGTERM');
    source.emit('SIGINT', 'SIGINT');

    await expect(waiter.received).resolves.toBe('SIGTERM');
    expect(repeats).toEqual(['SIGINT']);
    waiter.dispose();
  });

  it('removes its listeners when disposed', () => {
    const source = new EventEmitter();
    const waiter = waitForShutdown(source, () => {});
    expect(source.listenerCount('SIGINT')).toBe(1);
    expect(source.listenerCount('SIGTERM')).toBe(1);

    waiter.dispose();

    expect(source.listenerCount('SIGINT')).toBe(0);
    expect(source.listenerCount('SIGTERM')).toBe(0);
  });
});

describe('runWithTimeout', () => {
  it('reports a task that completes', async () => {
    await expect(runWithTimeout(async () => {}, 1_000)).resolves.toEqual({ status: 'done' });
  });

  it('reports a task that fails, with its error', async () => {
    const error = new Error('pool already closed');
    await expect(
      runWithTimeout(async () => {
        throw error;
      }, 1_000),
    ).resolves.toEqual({ status: 'failed', error });
  });

  it('stops waiting for a task that never finishes', async () => {
    const outcome = await runWithTimeout(() => new Promise<void>(() => {}), 20);
    expect(outcome).toEqual({ status: 'timeout' });
  });
});
