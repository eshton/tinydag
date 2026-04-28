import type { Connection, ConnectionSpec } from '../core/types.js';
import { openDuckDb } from './duckdb.js';
import { openPostgres } from './postgres.js';

export async function openConnection(spec: ConnectionSpec): Promise<Connection> {
  switch (spec.type) {
    case 'duckdb':
      return openDuckDb(spec);
    case 'postgres':
      return openPostgres(spec);
  }
}
