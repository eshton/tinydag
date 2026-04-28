import type { Connection, SqlStep, StepContext } from '../core/types.js';

export async function runSqlStep(
  step: SqlStep,
  ctx: StepContext,
  conn: Connection,
): Promise<void> {
  if (ctx.signal.aborted) {
    throw new Error('cancelled');
  }
  await conn.exec(step.sql);
}
