import { z } from 'zod';

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Shared pieces; each command composes only the variables it actually needs. */
export const logEnvSchema = z.object({
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
});

export const databaseEnvSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, hostname: /./ }).superRefine((url, ctx) => {
    const problem = findDatabaseUrlProblem(url);
    if (problem !== undefined) ctx.addIssue({ code: 'custom', message: problem });
  }),
  DB_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(5_000),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(10_000),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(20).default(5),
});

const BROKEN_ESCAPE = /%(?![0-9a-f]{2})/i;

/**
 * Checks the percent-encoding of a PostgreSQL URL the way pg-connection-string decodes it:
 * decodeURIComponent for user name, password and host, decodeURI for the database name.
 * pg re-encodes the whole URL when it finds whitespace or a "%" that does not start an escape,
 * which silently changes the meaning of the other escapes, so those inputs are rejected too.
 * Messages name the component, never its value.
 */
function findDatabaseUrlProblem(url: string): string | undefined {
  if (/\s/.test(url)) return 'must not contain whitespace (write a space as %20)';
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined; // z.url() reports this one.
  }
  const components = [
    ['user name', parsed.username, decodeURIComponent],
    ['password', parsed.password, decodeURIComponent],
    ['host', parsed.hostname, decodeURIComponent],
    ['database name', parsed.pathname.slice(1), decodeURI],
    ['query string', parsed.search + parsed.hash, undefined],
  ] as const;
  for (const [name, value, decode] of components) {
    if (BROKEN_ESCAPE.test(value))
      return `${name} has a "%" that does not start an escape (write "%" as %25)`;
    if (decode !== undefined && !decodes(value, decode)) return `${name} is not valid percent-encoded UTF-8`;
  }
  return undefined;
}

function decodes(value: string, decode: (encoded: string) => string): boolean {
  try {
    decode(value);
    return true;
  } catch (error) {
    if (error instanceof URIError) return false;
    throw error;
  }
}

export interface EnvProblem {
  name: string;
  reason: 'missing' | 'invalid';
  /** Describes the rule that failed. Never contains the supplied value. */
  detail: string;
}

export class EnvValidationError extends Error {
  readonly command: string;
  readonly problems: readonly EnvProblem[];

  constructor(command: string, problems: readonly EnvProblem[]) {
    const summary = problems
      .map((p) => (p.reason === 'missing' ? `${p.name} is missing` : `${p.name} is invalid (${p.detail})`))
      .join('; ');
    super(`Invalid environment for "${command}": ${summary}`);
    this.name = 'EnvValidationError';
    this.command = command;
    this.problems = problems;
  }
}

/**
 * Validates the variables one command needs. Empty strings count as unset, so `NAME=` in
 * .env falls back to the default. Unknown variables are ignored and not returned.
 */
export function parseEnv<Schema extends z.ZodObject>(
  command: string,
  schema: Schema,
  source: Readonly<Record<string, string | undefined>>,
): z.output<Schema> {
  const present: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (value !== undefined && value !== '') present[name] = value;
  }

  const result = schema.safeParse(present);
  if (result.success) return result.data;

  const problems = new Map<string, EnvProblem>();
  for (const issue of result.error.issues) {
    const name = String(issue.path[0] ?? '(environment)');
    if (problems.has(name)) continue;
    // Zod issue messages describe the rule, not the input (issues omit input by default).
    problems.set(name, {
      name,
      reason: present[name] === undefined ? 'missing' : 'invalid',
      detail: issue.message,
    });
  }
  throw new EnvValidationError(command, [...problems.values()]);
}
