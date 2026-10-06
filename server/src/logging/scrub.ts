export const REDACTED = '[REDACTED]';

// scheme://user:password@host -> scheme://user:[REDACTED]@host. The password part is greedy up to
// the last "@" before a path, query, whitespace or quote, so an unencoded "@" cannot leak a suffix.
const URL_PASSWORD = /([a-z][a-z0-9+.-]*:\/\/[^\s:/?#@"]*:)[^\s/?#"]*@/gi;

export type Scrubber = (text: string) => string;

/**
 * Builds a function that removes known secret values (raw, percent-encoded and JSON-escaped
 * forms) and any URL password from one string value. It runs on values before serialization,
 * never on finished JSON, so it cannot break JSON syntax or touch numeric fields.
 *
 * Every non-empty secret is replaced, however short: a short credential is still a credential.
 * The cost is that unrelated text containing the same characters is masked too.
 */
export function createScrubber(secrets: readonly string[]): Scrubber {
  const variants = new Set<string>();
  for (const secret of secrets) {
    for (const variant of [secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1)]) {
      if (variant !== '') variants.add(variant);
    }
  }
  // One pass with the longest alternatives first: a secret containing another one is replaced as
  // a whole, and text already replaced by [REDACTED] is not matched again.
  const known =
    variants.size === 0
      ? undefined
      : new RegExp(
          [...variants]
            .sort((a, b) => b.length - a.length)
            .map(escapeRegExp)
            .join('|'),
          'g',
        );

  return (text) => {
    const withoutKnown = known === undefined ? text : text.replace(known, REDACTED);
    return withoutKnown.replace(URL_PASSWORD, `$1${REDACTED}@`);
  };
}

function escapeRegExp(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|/-]/g, '\\$&');
}

/** Values that must never appear in logs for a given PostgreSQL connection URL. */
export function secretsFromDatabaseUrl(url: string): string[] {
  const secrets = [url];
  let password = '';
  try {
    password = new URL(url).password;
  } catch {
    // An unparseable URL is still registered as a whole; pattern masking covers the rest.
  }
  if (password !== '') {
    secrets.push(password);
    try {
      secrets.push(decodeURIComponent(password));
    } catch {
      // A malformed escape cannot be decoded; the encoded form is still registered above.
    }
  }
  return secrets;
}
