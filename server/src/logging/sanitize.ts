import { format } from 'node:util';
import type { Scrubber } from './scrub.ts';
import { serializeError } from './serialize-error.ts';

const MAX_DEPTH = 8;

/**
 * Returns a copy of a logged value that is safe to serialize. Errors become allowlisted plain
 * objects, every string is scrubbed, and numbers, booleans and null are kept unchanged.
 * Objects with toJSON (Date, URL, Buffer) are converted first, because JSON output would call
 * it anyway and a URL's JSON form contains its password.
 */
export function sanitizeValue(
  value: unknown,
  scrub: Scrubber,
  depth = 0,
  ancestors = new WeakSet<object>(),
): unknown {
  if (typeof value === 'string') return scrub(value);
  if (typeof value !== 'object' || value === null) return value;
  if (depth >= MAX_DEPTH) return '[Truncated]';
  if (ancestors.has(value)) return '[Circular]';

  ancestors.add(value);
  try {
    if (value instanceof Error) return sanitizeValue(serializeError(value), scrub, depth, ancestors);
    if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, scrub, depth + 1, ancestors));
    const toJSON: unknown = Reflect.get(value, 'toJSON');
    if (typeof toJSON === 'function') {
      return sanitizeValue(toJSON.call(value), scrub, depth + 1, ancestors);
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sanitizeValue(item, scrub, depth + 1, ancestors)]),
    );
  } finally {
    ancestors.delete(value);
  }
}

/**
 * Sanitizes the arguments of one logger call before pino sees them. A bare error is wrapped as
 * `{ err }`, so pino still uses its message as `msg`, but now the scrubbed copy of it.
 */
export function sanitizeLogArguments(args: readonly unknown[], scrub: Scrubber): unknown[] {
  const [first, ...rest] = args;
  if (typeof first === 'object' && first !== null) {
    const fields = first instanceof Error ? { err: first } : first;
    return [sanitizeValue(fields, scrub), ...sanitizeMessage(rest, scrub)];
  }
  return sanitizeMessage(args, scrub);
}

function sanitizeMessage(parts: readonly unknown[], scrub: Scrubber): unknown[] {
  const sanitized = parts.map((part) => sanitizeValue(part, scrub));
  if (sanitized.length <= 1) return sanitized;
  // Formatting here and scrubbing the result also catches a secret split across arguments.
  return [scrub(format(...sanitized))];
}
