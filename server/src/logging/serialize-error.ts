export interface SerializedError {
  type: string;
  message: string;
  code?: string;
  stack?: string;
  cause?: SerializedError;
  errors?: SerializedError[];
}

const MAX_CAUSE_DEPTH = 3;
const MAX_AGGREGATED_ERRORS = 5;

/**
 * Copies only an allowlist of fields. Libraries attach extra properties to errors (pg adds
 * `detail` with row values, Node's URL errors add `input` with the full URL), so copying every
 * enumerable property, as pino's default serializer does, could log data or credentials.
 * The strings in the result are scrubbed afterwards by sanitizeValue().
 */
export function serializeError(value: unknown, depth = 0): SerializedError {
  if (!(value instanceof Error)) {
    return { type: typeof value, message: String(value) };
  }

  const serialized: SerializedError = { type: value.name, message: value.message };
  const code: unknown = Reflect.get(value, 'code');
  if (typeof code === 'string' || typeof code === 'number') serialized.code = String(code);
  if (value.stack !== undefined) serialized.stack = value.stack;

  if (depth < MAX_CAUSE_DEPTH) {
    if (value.cause !== undefined) serialized.cause = serializeError(value.cause, depth + 1);
    if (value instanceof AggregateError) {
      const errors: unknown[] = Array.from(value.errors);
      serialized.errors = errors
        .slice(0, MAX_AGGREGATED_ERRORS)
        .map((inner) => serializeError(inner, depth + 1));
    }
  }
  return serialized;
}
