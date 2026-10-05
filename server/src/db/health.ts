import type { Pool } from 'pg';

export interface HealthResult {
  latencyMs: number;
}

/** Runs `SELECT 1` and checks the returned row, so a misbehaving proxy cannot fake success. */
export async function checkDatabase(pool: Pool): Promise<HealthResult> {
  const started = performance.now();
  const result = await pool.query<{ ok: number }>('SELECT 1 AS ok');
  if (result.rows[0]?.ok !== 1) {
    throw new Error('Database health check returned an unexpected result');
  }
  return { latencyMs: Math.round(performance.now() - started) };
}
