# postgres-load — bundled tinydag example

Demonstrates a real DuckDB → Postgres pipeline:

1. **`extract`** (SQL on DuckDB) — read messy `users.csv` into a staging table.
2. **`transform`** (SQL on DuckDB) — clean it up (lowercase + trim emails).
3. **`prepare_target`** (SQL on Postgres) — `CREATE TABLE IF NOT EXISTS users (...)`.
4. **`load`** (custom TS on Postgres) — pull cleaned rows from DuckDB, upsert
   them into Postgres inside a transaction with `ON CONFLICT DO UPDATE`.

The transform + prepare_target steps run in parallel (they have no
dependency on each other); load waits for both.

## Run locally

You need a running Postgres. Easiest path:

```sh
docker run -d --name tinydag-pg -p 5432:5432 \
  -e POSTGRES_USER=tinydag \
  -e POSTGRES_PASSWORD=tinydag \
  -e POSTGRES_DB=tinydag \
  postgres:16
```

Then:

```sh
# from the repo root
pnpm install
pnpm -r build

# run the example
PG_URL=postgresql://tinydag:tinydag@localhost:5432/tinydag \
  pnpm --filter postgres-load-example run run
```

Verify the rows landed:

```sh
PGPASSWORD=tinydag psql -h localhost -U tinydag -d tinydag \
  -c "SELECT id, email FROM users ORDER BY id"
```

Cleanup:

```sh
docker rm -f tinydag-pg
```

## Run from a scaffolded project

```sh
npx tinydag init my-pg-pipeline --example postgres-load
cd my-pg-pipeline
npm install
PG_URL=postgresql://tinydag:tinydag@localhost:5432/tinydag npm run run
```

## What this example exercises

- **Mixed connection types in one DAG.** DuckDB as the working store,
  Postgres as the result store.
- **The unified `Connection` interface.** The handler uses
  `ctx.connections.warehouse.query<T>(...)` and
  `ctx.connections.results.query(sql, params)` — same shape for both.
- **Parameterized SQL** (`$1, $2`) on Postgres — no string interpolation,
  no SQL injection risk.
- **Transactional upserts.** `BEGIN` / `COMMIT` / `ROLLBACK` via
  `pg.exec(...)`; rollback on any per-row failure.
- **`ctx.signal` for cancellation.** Long upsert loops bail on Ctrl-C.

## Pipeline shape

```
extract ─→ transform ─┐
                      ├─→ load (custom TS, target: postgres)
prepare_target ───────┘
```

## Limitations

- This example uses a `.ts` handler, so `tinydag example run postgres-load`
  won't work (Node can't load `.ts` natively). Use `tinydag init` to
  scaffold it into a project that has tsx, or pre-compile the handler.
- The Postgres connector has no integration tests in v1 *outside* CI,
  which runs this example against a service container. So consider this
  example the integration test for the connector itself.

See `../../packages/tinydag/README.md` for deeper docs.
