export const REDACTED = '[REDACTED]';

/**
 * Secrets shorter than this are not replaced by value: replacing short, common strings
 * would corrupt unrelated log text. URL passwords are still masked by pattern.
 */
export const MIN_SECRET_LENGTH = 8;

// scheme://user:password@host -> scheme://user:[REDACTED]@host. The password part is greedy up to
// the last "@" before a path, query, whitespace or quote, so an unencoded "@" cannot leak a suffix.
const URL_PASSWORD = /([a-z][a-z0-9+.-]*:\/\/[^\s:/?#@"]*:)[^\s/?#"]*@/gi;

export type Scrubber = (text: string) => string;

/**
 * Builds a function that removes known secret values (raw, percent-encoded and JSON-escaped
 * forms) and any URL password from a piece of text.
 */
export function createScrubber(secrets: readonly string[]): Scrubber {
  const variants = new Set<string>();
  for (const secret of secrets) {
    if (secret.length < MIN_SECRET_LENGTH) continue;
    variants.add(secret);
    variants.add(encodeURIComponent(secret));
    variants.add(JSON.stringify(secret).slice(1, -1));
  }
  // Longest first, so a secret that contains another secret is replaced as a whole.
  const ordered = [...variants].sort((a, b) => b.length - a.length);

  return (text) => {
    let result = text;
    for (const variant of ordered) result = result.split(variant).join(REDACTED);
    return result.replace(URL_PASSWORD, `$1${REDACTED}@`);
  };
}

/** Values that must never appear in logs for a given PostgreSQL connection URL. */
export function secretsFromDatabaseUrl(url: string): string[] {
  const secrets = [url];
  try {
    const password = new URL(url).password;
    if (password !== '') secrets.push(password, decodeURIComponent(password));
  } catch {
    // An unparseable URL is still registered as a whole; pattern masking covers the rest.
  }
  return secrets;
}
