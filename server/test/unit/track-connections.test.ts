import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { trackConnections } from '../../src/db/pool.ts';

/** Reports whether the promise has resolved after pending callbacks have run. */
async function isResolved(promise: Promise<void>): Promise<boolean> {
  let resolved = false;
  void promise.then(() => {
    resolved = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  return resolved;
}

describe('trackConnections', () => {
  it('resolves at once when the pool never connected', async () => {
    expect(await isResolved(trackConnections(new EventEmitter()).allClosed())).toBe(true);
  });

  it('waits until every connected client has ended', async () => {
    const pool = new EventEmitter();
    const connections = trackConnections(pool);
    const first = new EventEmitter();
    const second = new EventEmitter();
    pool.emit('connect', first);
    pool.emit('connect', second);

    const allClosed = connections.allClosed();
    first.emit('end');
    expect(await isResolved(allClosed)).toBe(false);

    second.emit('end');
    expect(await isResolved(allClosed)).toBe(true);
  });

  it('destroys leftover sockets on abandon', () => {
    const pool = new EventEmitter();
    const connections = trackConnections(pool);
    const destroyed: string[] = [];
    const stillOpen = {
      once: () => stillOpen,
      connection: { stream: { destroy: () => destroyed.push('open') } },
    };
    const alreadyEnded = {
      once: (_event: string, listener: () => void) => {
        listener();
        return alreadyEnded;
      },
      connection: { stream: { destroy: () => destroyed.push('ended') } },
    };
    pool.emit('connect', stillOpen);
    pool.emit('connect', alreadyEnded);

    connections.abandon();

    expect(destroyed).toEqual(['open']);
  });

  it('does not wait for clients that ended before shutdown', async () => {
    const pool = new EventEmitter();
    const connections = trackConnections(pool);
    const client = new EventEmitter();
    pool.emit('connect', client);
    client.emit('end');

    expect(await isResolved(connections.allClosed())).toBe(true);
  });
});
