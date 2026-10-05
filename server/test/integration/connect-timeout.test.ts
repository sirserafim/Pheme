import { type AddressInfo, createServer, type Socket } from 'node:net';
import { describe, expect, it } from 'vitest';
import { checkDatabase } from '../../src/db/health.ts';
import { createPool } from '../../src/db/pool.ts';
import { createLogger } from '../../src/logging/logger.ts';

const CONNECT_TIMEOUT_MS = 300;

describe('database connection timeout', () => {
  it('gives up when a server accepts TCP but never answers the PostgreSQL handshake', async () => {
    const sockets = new Set<Socket>();
    const silentServer = createServer((socket) => {
      sockets.add(socket);
    });
    await new Promise<void>((resolve) => silentServer.listen(0, '127.0.0.1', resolve));
    const { port } = silentServer.address() as AddressInfo;

    const pool = createPool(
      {
        url: `postgres://probe:probe-password@127.0.0.1:${port}/probe`,
        connectTimeoutMs: CONNECT_TIMEOUT_MS,
        statementTimeoutMs: 1_000,
        poolMax: 1,
      },
      createLogger({ level: 'silent' }),
    );

    const started = performance.now();
    try {
      await expect(checkDatabase(pool)).rejects.toThrow(/timeout/i);
      const elapsedMs = performance.now() - started;
      expect(sockets.size).toBeGreaterThan(0);
      expect(elapsedMs).toBeGreaterThanOrEqual(CONNECT_TIMEOUT_MS - 50);
      expect(elapsedMs).toBeLessThan(CONNECT_TIMEOUT_MS + 2_000);
    } finally {
      await pool.end();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => silentServer.close(() => resolve()));
    }
  });
});
