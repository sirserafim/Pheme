import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LogRecord } from '../support/capture-logs.ts';
import { startTestDatabase, type TestDatabase } from './support/test-database.ts';

const SERVER_DIR = fileURLToPath(new URL('../..', import.meta.url));
const APP_PASSWORD = 'dev-process-app-password';
const WRONG_PASSWORD = 'wrong-password-must-not-be-logged';

let db: TestDatabase;

beforeAll(async () => {
  db = await startTestDatabase({ database: 'pheme', appPassword: APP_PASSWORD });
});

afterAll(async () => {
  await db?.container.stop();
});

interface DevProcess {
  child: ChildProcess;
  exitCode: Promise<number | null>;
  records: LogRecord[];
  stderr: () => string;
  stdout: () => string;
  waitForMessage: (msg: string, timeoutMs?: number) => Promise<void>;
}

/** Runs the same entry point as `npm run dev`, with an explicit environment instead of .env. */
function startDev(env: Record<string, string>): DevProcess {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
    cwd: SERVER_DIR,
    env: { ...process.env, LOG_LEVEL: 'info', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exitCode = once(child, 'exit').then(([code]) => code as number | null);
  const records: LogRecord[] = [];
  const stderrLines: string[] = [];
  let stdout = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8');
  });
  if (child.stderr === null) throw new Error('stderr is not piped');
  const lines = createInterface({ input: child.stderr });
  lines.on('line', (line) => {
    stderrLines.push(line);
    try {
      records.push(JSON.parse(line) as LogRecord);
    } catch {
      // Non-JSON output (for example a Node warning) stays in stderr() for assertions.
    }
  });

  const waitForMessage = async (msg: string, timeoutMs = 20_000) => {
    const deadline = Date.now() + timeoutMs;
    while (!records.some((r) => r.msg === msg)) {
      if (child.exitCode !== null)
        throw new Error(`dev exited before logging "${msg}":\n${stderrLines.join('\n')}`);
      if (Date.now() > deadline)
        throw new Error(`timed out waiting for "${msg}":\n${stderrLines.join('\n')}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };

  return {
    child,
    exitCode,
    records,
    stderr: () => stderrLines.join('\n'),
    stdout: () => stdout,
    waitForMessage,
  };
}

describe('dev process against a real PostgreSQL', () => {
  it('logs db ok with the target but without the password', async () => {
    const dev = startDev({ DATABASE_URL: db.appUrl });
    try {
      await dev.waitForMessage('db ok');
      const ok = dev.records.find((r) => r.msg === 'db ok');
      expect(ok).toMatchObject({
        db: { user: 'pheme_app', database: 'pheme' },
        latencyMs: expect.any(Number),
      });
      expect(dev.stderr()).not.toContain(APP_PASSWORD);
      expect(dev.stdout()).toBe('');
    } finally {
      dev.child.kill();
      await dev.exitCode;
    }
  });

  // Node on Windows cannot deliver SIGINT to a child process (kill() terminates it), so the
  // graceful path is verified on Linux here and by a manual Ctrl+C on Windows.
  it.skipIf(process.platform === 'win32')('shuts down cleanly with exit code 0 on SIGINT', async () => {
    const dev = startDev({ DATABASE_URL: db.appUrl });
    await dev.waitForMessage('db ok');

    dev.child.kill('SIGINT');

    expect(await dev.exitCode).toBe(0);
    expect(dev.records.map((r) => r.msg)).toEqual(
      expect.arrayContaining(['dev starting', 'db ok', 'shutdown requested', 'shutdown complete']),
    );
  });

  it('exits with 1 and logs the error code, not the password, when authentication fails', async () => {
    const wrong = new URL(db.appUrl);
    wrong.password = WRONG_PASSWORD;
    const dev = startDev({ DATABASE_URL: wrong.toString() });

    expect(await dev.exitCode).toBe(1);
    const failure = dev.records.find((r) => r.msg === 'db check failed');
    expect(failure?.err?.code).toBe('28P01');
    expect(dev.stderr()).not.toContain(WRONG_PASSWORD);
  });
});
