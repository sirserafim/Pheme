import type { DestinationStream } from 'pino';

export interface LogRecord {
  msg?: string;
  err?: {
    type?: string;
    message?: string;
    code?: string;
    stack?: string;
    cause?: { message?: string };
    errors?: { message?: string }[];
  };
  [field: string]: unknown;
}

/** Collects finished log lines in memory instead of writing them to stderr. */
export function captureLogs() {
  const lines: string[] = [];
  const destination: DestinationStream = {
    write: (line: string) => {
      lines.push(line);
    },
  };
  return {
    destination,
    text: () => lines.join(''),
    records: () => lines.map((line) => JSON.parse(line) as LogRecord),
  };
}
