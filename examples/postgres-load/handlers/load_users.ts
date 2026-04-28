import type { StepContext } from 'tinydag';

interface UserRow {
  id: number;
  email: string;
}

export default async function loadUsers(ctx: StepContext): Promise<void> {
  const duck = ctx.connections.warehouse;
  const pg = ctx.connections.results;
  if (!duck) throw new Error('warehouse connection not available');
  if (!pg) throw new Error('results connection not available');

  const rows = await duck.query<UserRow>(
    'SELECT id, email FROM clean_users ORDER BY id',
  );
  ctx.logger.info(`upserting ${rows.length} users into Postgres`);

  await pg.exec('BEGIN');
  try {
    for (const row of rows) {
      if (ctx.signal.aborted) throw new Error('cancelled');
      await pg.query(
        `INSERT INTO users (id, email) VALUES ($1, $2)
         ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email`,
        [row.id, row.email],
      );
    }
    await pg.exec('COMMIT');
  } catch (err) {
    await pg.exec('ROLLBACK');
    throw err;
  }

  const countRows = await pg.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM users',
  );
  const count = countRows[0]?.count ?? '0';
  ctx.logger.info(`users table now has ${count} rows`);
}
