import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { POSTGRES_IMAGE } from '../../support/postgres-image.ts';

const INIT_SCRIPT = fileURLToPath(
  new URL('../../../../docker/postgres/init/10-create-app-role.sh', import.meta.url),
);

export interface TestDatabase {
  container: StartedPostgreSqlContainer;
  /** Bootstrap superuser; only for test setup, never used by application code. */
  adminUrl: string;
  /** The least-privilege pheme_app role created by the init script. */
  appUrl: string;
}

/**
 * Starts a disposable PostgreSQL container with the same image and init script as compose.yaml.
 * The container is removed by stop() and, if the test process dies, by Testcontainers' reaper.
 */
export async function startTestDatabase(options: {
  database: string;
  appPassword: string;
}): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withDatabase(options.database)
    .withUsername('pheme_admin')
    .withPassword(randomBytes(16).toString('hex'))
    .withEnvironment({ PHEME_APP_DB_PASSWORD: options.appPassword })
    .withCopyFilesToContainer([
      { source: INIT_SCRIPT, target: '/docker-entrypoint-initdb.d/10-create-app-role.sh', mode: 0o755 },
    ])
    .start();

  const adminUrl = container.getConnectionUri();
  const app = new URL(adminUrl);
  app.username = 'pheme_app';
  // The URL setter percent-encodes characters such as spaces, quotes and ';'.
  app.password = options.appPassword;
  return { container, adminUrl, appUrl: app.toString() };
}
