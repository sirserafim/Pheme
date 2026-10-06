/** Counts how many times `needle` appears, so assertions never print the needle on failure. */
export function countOccurrences(haystack: string, needle: string): number {
  if (needle === '') return 0;
  return haystack.split(needle).length - 1;
}

/** Replaces every non-empty secret with a placeholder, for error messages and diagnostics. */
export function withoutSecrets(text: string, secrets: readonly string[]): string {
  let result = text;
  for (const secret of secrets) {
    if (secret !== '') result = result.split(secret).join('[REDACTED]');
  }
  return result;
}
