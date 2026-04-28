import { DuckDBInstance } from '@duckdb/node-api';
import type { DuckDBConnection } from '@duckdb/node-api';
import type { Connection, DuckDbConnectionSpec } from '../core/types.js';

export async function openDuckDb(spec: DuckDbConnectionSpec): Promise<Connection> {
  const instance = await DuckDBInstance.create(spec.path);
  const conn = await instance.connect();

  return {
    raw: conn,

    async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
      const reader = await conn.runAndReadAll(sql, params as never);
      return reader.getRowObjectsJS() as T[];
    },

    async exec(sql: string): Promise<void> {
      await conn.run(sql);
    },

    async close(): Promise<void> {
      try {
        conn.closeSync();
      } catch {
        // ignore double-close
      }
      try {
        instance.closeSync();
      } catch {
        // ignore
      }
    },
  };
}

/** Re-exported so callers can `as DuckDBConnection` if they need raw access. */
export type { DuckDBConnection };
