import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          // The first run may pull the PostgreSQL image; container start-up happens in hooks.
          hookTimeout: 180_000,
          testTimeout: 30_000,
        },
      },
    ],
  },
});
