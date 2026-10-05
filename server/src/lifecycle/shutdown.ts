export const SHUTDOWN_SIGNALS: readonly NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];

/** The subset of `process` used for signals; tests pass an EventEmitter instead. */
export interface SignalSource {
  on(signal: NodeJS.Signals, listener: (signal: NodeJS.Signals) => void): unknown;
  off(signal: NodeJS.Signals, listener: (signal: NodeJS.Signals) => void): unknown;
}

export interface ShutdownWaiter {
  /** Resolves with the first signal received. */
  received: Promise<NodeJS.Signals>;
  /** Removes the signal listeners and the keep-alive timer. */
  dispose(): void;
}

/**
 * Listens for shutdown signals from the start of a command, so Ctrl+C during startup is
 * handled rather than killing the process mid-connection. Signals after the first one call
 * `onRepeat`, which lets a user force an exit if graceful shutdown hangs.
 */
export function waitForShutdown(
  source: SignalSource,
  onRepeat: (signal: NodeJS.Signals) => void,
  signals: readonly NodeJS.Signals[] = SHUTDOWN_SIGNALS,
): ShutdownWaiter {
  let resolveReceived: (signal: NodeJS.Signals) => void = () => {};
  const received = new Promise<NodeJS.Signals>((resolve) => {
    resolveReceived = resolve;
  });

  // Until the project has a server, nothing else keeps the event loop alive while waiting.
  const keepAlive = setInterval(() => {}, 60_000);
  let first: NodeJS.Signals | undefined;

  const listener = (signal: NodeJS.Signals) => {
    if (first === undefined) {
      first = signal;
      clearInterval(keepAlive);
      resolveReceived(signal);
    } else {
      onRepeat(signal);
    }
  };
  for (const signal of signals) source.on(signal, listener);

  return {
    received,
    dispose: () => {
      clearInterval(keepAlive);
      for (const signal of signals) source.off(signal, listener);
    },
  };
}

export type TimedOutcome = { status: 'done' } | { status: 'failed'; error: unknown } | { status: 'timeout' };

/** Runs a cleanup step with an upper bound, so a hung cleanup cannot block exit forever. */
export async function runWithTimeout(task: () => Promise<void>, timeoutMs: number): Promise<TimedOutcome> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<TimedOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ status: 'timeout' }), timeoutMs);
  });
  const work = task().then(
    (): TimedOutcome => ({ status: 'done' }),
    (error: unknown): TimedOutcome => ({ status: 'failed', error }),
  );
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
