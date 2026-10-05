import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { POSTGRES_IMAGE } from '../support/postgres-image.ts';

const compose = readFileSync(new URL('../../../compose.yaml', import.meta.url), 'utf8');

describe('compose.yaml policy', () => {
  it('uses the same pinned PostgreSQL image as the integration tests', () => {
    expect(compose).toContain(`image: ${POSTGRES_IMAGE}`);
  });

  it('publishes PostgreSQL on the loopback interface only', () => {
    const portMappings = [...compose.matchAll(/^\s*-\s*"?([^"\s]+:5432)"?\s*$/gm)].map((m) => m[1]);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Compose variable syntax, compared literally.
    expect(portMappings).toEqual(['127.0.0.1:${POSTGRES_HOST_PORT:-5432}:5432']);
  });

  it('keeps data in a named volume at the path declared by PostgreSQL 18 images', () => {
    expect(compose).toMatch(/^\s*-\s*pgdata:\/var\/lib\/postgresql\s*$/m);
    expect(compose).toMatch(/^volumes:\s*\n\s+pgdata:/m);
    expect(compose).not.toMatch(/^\s*-\s*[^#\s]*:\/var\/lib\/postgresql\/data/m);
  });
});
