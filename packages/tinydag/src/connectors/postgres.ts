import type { Connection, PostgresConnectionSpec } from '../core/types.js';

export async function openPostgres(spec: PostgresConnectionSpec): Promise<Connection> {
  let Client: typeof import('pg').Client;
  try {
    const pgModule = await import('pg');
    // pg is a CJS module — its named exports come from the default export under ESM.
    Client = (pgModule.default?.Client ?? pgModule.Client) as typeof import('pg').Client;
  } catch {
    throw new Error('Postgres connector requires "pg". Install with: npm install pg');
  }

  const client = spec.url
    ? new Client({ connectionString: spec.url })
    : new Client({
        host: spec.host,
        port: spec.port,
        database: spec.database,
        user: spec.user,
        password: spec.password,
      });

  await client.connect();

  return {
    raw: client,

    async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
      const result = await client.query<T extends Record<string, unknown> ? T : never>(sql, params as never);
      return result.rows as T[];
    },

    async exec(sql: string): Promise<void> {
      await client.query(sql);
    },

    async close(): Promise<void> {
      try {
        await client.end();
      } catch {
        // ignore double-close
      }
    },
  };
}
