import { type ChildProcess, spawn } from 'node:child_process';
import { createInterface, type Interface as ReadLine } from 'node:readline';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { LogRecord } from '../support/capture-logs.ts';
import { countOccurrences, withoutSecrets } from '../support/secrets.ts';
import { startTestDatabase, type TestDatabase } from './support/test-database.ts';

const SERVER_DIR = fileURLToPath(new URL('../..', import.meta.url));
const APP_PASSWORD = 'dev-process-app-password';
const WRONG_PASSWORD = 'wrong-password-must-not-be-logged';
const SECRETS = [APP_PASSWORD, WRONG_PASSWORD];

let db: TestDatabase;
let running: DevProcess | undefined;

beforeAll(async () => {
  db = await startTestDatabase({ database: 'pheme', appPassword: APP_PASSWORD });
});

afterEach(async () => {
  if (running === undefined) return;
  const proc = running;
  running = undefined;
  await proc.dispose();
});

afterAll(async () => {
  await db?.container.stop();
});

interface ClosedProcess {
  code: number | null;
  signal: NodeJS.Signals | null;
}

interface DevProcess {
  child: ChildProcess;
  closed: Promise<ClosedProcess>;
  records: LogRecord[];
  stderr: () => string;
  stdout: () => string;
  waitForMessage: (msg: string, timeoutMs?: number) => Promise<void>;
  dispose: () => Promise<void>;
}

/** Runs the same entry point as `npm run dev`, with an explicit environment instead of .env. */
function startDev(env: Record<string, string>): DevProcess {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
    cwd: SERVER_DIR,
    env: { ...process.env, LOG_LEVEL: 'info', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const records: LogRecord[] = [];
  const stderrLines: string[] = [];
  let stdout = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8');
  });
  if (child.stderr === null) throw new Error('stderr is not piped');
  const lines = createInterface({ input: child.stderr });
  const onLine = (line: string) => {
    stderrLines.push(line);
    try {
      records.push(JSON.parse(line) as LogRecord);
    } catch {
      // Non-JSON output (for example a Node warning) stays in stderr() for assertions.
    }
  };
  lines.on('line', onLine);

  const closed = waitForClose(child, lines, child.stderr);
  const proc: DevProcess = {
    child,
    closed,
    records,
    stderr: () => stderrLines.join('\n'),
    stdout: () => stdout,
    waitForMessage: (msg, timeoutMs = 20_000) =>
      waitForLogMessage(msg, timeoutMs, { closed, records, lines, stderrLines }),
    dispose: () => disposeDev(child, closed),
  };
  running = proc;
  return proc;
}

function waitForClose(child: ChildProcess, lines: ReadLine, stderr: Readable): Promise<ClosedProcess> {
  return new Promise((resolve, reject) => {
    let result: ClosedProcess | undefined;
    let linesClosed = stderr.readableEnded || stderr.destroyed;
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) return;
      if (error !== undefined) {
        settled = true;
        reject(error);
        return;
      }
      if (result === undefined || !linesClosed) return;
      settled = true;
      resolve(result);
    };

    child.once('error', (error) => finish(new Error(`failed to start the dev process (${error.message})`)));
    child.once('close', (code, signal) => {
      result = { code, signal };
      finish();
    });
    if (linesClosed) finish();
    else
      lines.once('close', () => {
        linesClosed = true;
        finish();
      });
  });
}

async function waitForLogMessage(
  msg: string,
  timeoutMs: number,
  ctx: {
    closed: Promise<ClosedProcess>;
    records: LogRecord[];
    lines: ReadLine;
    stderrLines: string[];
  },
): Promise<void> {
  if (ctx.records.some((record) => record.msg === msg)) return;

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ctx.lines.off('line', onLine);
      if (error !== undefined) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => {
      finish(new Error(diagnostic(`timed out waiting for "${msg}":\n${ctx.stderrLines.join('\n')}`)));
    }, timeoutMs);
    const onLine = () => {
      if (ctx.records.some((record) => record.msg === msg)) finish();
    };
    ctx.lines.on('line', onLine);
    void ctx.closed.then(
      (closed) => {
        if (ctx.records.some((record) => record.msg === msg)) {
          finish();
          return;
        }
        finish(
          new Error(
            diagnostic(
              `dev closed before logging "${msg}" (code=${closed.code}, signal=${closed.signal}):\n${ctx.stderrLines.join('\n')}`,
            ),
          ),
        );
      },
      (error: unknown) => finish(error instanceof Error ? error : new Error(String(error))),
    );
  });
}

async function disposeDev(child: ChildProcess, closed: Promise<ClosedProcess>): Promise<void> {
  if (child.exitCode === null && child.signalCode === null) {
    try {
      child.kill('SIGKILL');
    } catch {
      // The process is already gone.
    }
  }
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('child did not close within 5 s after cleanup')), 5_000);
  });
  await Promise.race([closed.catch(() => undefined), timeout]);
}

function diagnostic(text: string): string {
  return withoutSecrets(text, SECRETS);
}

describe('dev process against a real PostgreSQL', () => {
  it('logs db ok with the target but without the password', async () => {
    const dev = startDev({ DATABASE_URL: db.appUrl });
    await dev.waitForMessage('db ok');
    const ok = dev.records.find((r) => r.msg === 'db ok');
    expect(ok).toMatchObject({
      db: { user: 'pheme_app', database: 'pheme' },
      latencyMs: expect.any(Number),
    });
    expect(countOccurrences(dev.stderr(), APP_PASSWORD)).toBe(0);
    expect(dev.stdout()).toBe('');
  });

  // Node on Windows cannot deliver SIGINT to a child process (kill() terminates it), so the
  // graceful path is verified on Linux here and by a real console Ctrl+C on Windows.
  it.skipIf(process.platform === 'win32')('shuts down cleanly with exit code 0 on SIGINT', async () => {
    const dev = startDev({ DATABASE_URL: db.appUrl });
    await dev.waitForMessage('db ok');

    dev.child.kill('SIGINT');

    const closed = await dev.closed;
    expect(closed).toEqual({ code: 0, signal: null });
    expect(dev.records.map((r) => r.msg)).toEqual(
      expect.arrayContaining(['dev starting', 'db ok', 'shutdown requested', 'shutdown complete']),
    );
    expect(countOccurrences(dev.stderr(), APP_PASSWORD)).toBe(0);
  });

  it('exits with 1 and logs the error code, not the password, when authentication fails', async () => {
    const wrong = new URL(db.appUrl);
    wrong.password = WRONG_PASSWORD;
    const dev = startDev({ DATABASE_URL: wrong.toString() });

    const closed = await dev.closed;
    expect(closed).toEqual({ code: 1, signal: null });
    const failure = dev.records.find((r) => r.msg === 'db check failed');
    expect(failure?.err?.code).toBe('28P01');
    expect(countOccurrences(dev.stderr(), WRONG_PASSWORD)).toBe(0);
  });
});
