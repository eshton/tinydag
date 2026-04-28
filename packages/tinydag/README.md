# tinydag

A tiny, YAML-driven ETL framework for TypeScript. Define DAGs of SQL or
TypeScript steps, run them from the CLI. Ships with DuckDB built in;
optional Postgres connector.

- **Declarative.** A pipeline is one YAML file.
- **Parallel by default.** Steps run as soon as their dependencies satisfy.
- **DuckDB-first.** Read CSV/JSON/Parquet, transform in SQL, export — no
  database to set up.
- **Optional connectors.** Postgres is opt-in (peer dep); others are not in v1.
- **Custom TypeScript steps.** When SQL isn't enough, write a function.

## Install

### Zero-install (npx) — for SQL-only DAGs

```sh
# Try the bundled example end-to-end.
npx tinydag example run csv-merge

# Scaffold your own pipeline from that example.
npx tinydag init my-pipeline
cd my-pipeline
npx tinydag run dag.yml
```

DuckDB is bundled, so `read_csv_auto`, `COPY ... TO`, and any in-database
SQL just work. No `package.json`, no clone, no infra.

### Local install — for projects with custom TypeScript steps

```sh
mkdir my-pipeline && cd my-pipeline
npm init -y
npm install tinydag
npx tinydag run dag.yml
```

Required when the DAG has `type: custom` steps, because the handler `.ts`
imports `StepContext` from `tinydag` and that import has to resolve to a
local installation.

If the DAG also targets Postgres, add `npm install pg`. tinydag prints an
actionable error if it's missing.

### Picking between the two

| You want to…                          | Use                                  |
|---------------------------------------|--------------------------------------|
| Run a YAML DAG that's only SQL        | `npx tinydag` / global install       |
| Use custom TypeScript step handlers   | Local `npm install tinydag`          |
| Load data into Postgres               | Local install + `npm install pg`     |
| Quickly demo tinydag to someone       | `npx tinydag example run csv-merge`  |

The npx path is intentionally limited to SQL-only DAGs. Mixing TypeScript
handlers with a global install leads to module-resolution headaches and is
not supported.

## Quick start

A minimal DAG (`dag.yml`):

```yaml
# yaml-language-server: $schema=https://unpkg.com/tinydag/schemas/dag.schema.json
name: hello
connections:
  warehouse:
    type: duckdb
    path: ":memory:"

steps:
  - id: load
    type: sql
    target: warehouse
    sql: |
      CREATE TABLE rows AS SELECT * FROM range(10) AS t(n);

  - id: export
    type: sql
    target: warehouse
    depends_on: [load]
    sql: |
      COPY rows TO 'rows.json' (FORMAT JSON, ARRAY true);
```

Then:

```sh
tinydag validate dag.yml   # parse + check structure, no execution
tinydag list dag.yml       # print step graph
tinydag run dag.yml        # execute
```

## CLI

```
tinydag run <file>          Execute a DAG.
tinydag validate <file>     Parse, resolve vars, check cycles. No execution.
tinydag list <file>         Print the step graph.
tinydag init [dir]          Scaffold a project from a bundled example.
tinydag example list        List bundled examples.
tinydag example run <name>  Run a bundled example end-to-end (in place).
```

### Common flags (for `run`, `validate`, `list`)

| Flag                | Description                                              |
|---------------------|----------------------------------------------------------|
| `--env-file <path>` | dotenv file to load (default: `.env` in cwd, if exists). |
| `--var key=value`   | Override / supply a pipeline var. Repeatable.            |
| `--concurrency N`   | Cap parallel steps. Default: unlimited.                  |
| `--log <fmt>`       | `pretty` (default) | `json`.                            |
| `--log-level <lvl>` | `debug` | `info` (default) | `warn` | `error`.          |

### `init` flags

| Flag                | Description                                             |
|---------------------|---------------------------------------------------------|
| `--example <name>`  | Which bundled example to seed from. Default: `csv-merge`. |
| `--force`           | Overwrite an existing non-empty target dir.             |

### Exit codes

| Code | Meaning                          |
|------|----------------------------------|
| 0    | All steps succeeded.             |
| 1    | One or more steps failed.        |
| 2    | Validation / parse error.        |
| 130  | Cancelled by SIGINT.             |

## DAG file format

YAML. One file per pipeline.

### Top-level keys

| Key           | Required | Description                                          |
|---------------|----------|------------------------------------------------------|
| `name`        | yes      | Pipeline identifier (used in logs).                  |
| `description` | no       | Free-form.                                           |
| `connections` | yes      | Map of name → connection config.                     |
| `vars`        | no       | Pipeline variables, used via `${vars.X}`.            |
| `steps`       | yes      | List of step definitions. Order is for human readability — execution order is determined by `depends_on`. |

### Connections

```yaml
connections:
  warehouse:
    type: duckdb
    path: ./data/warehouse.duckdb     # or ":memory:"

  results:
    type: postgres
    url: ${env.PG_URL}
    # OR component form:
    # host: db.local
    # port: 5432
    # database: app
    # user: app
    # password: ${env.PG_PASSWORD}
```

Connection names must match `[a-z0-9_]+`.

### Steps

| Field         | Required | Notes                                              |
|---------------|----------|----------------------------------------------------|
| `id`          | yes      | Unique within file. `[a-z0-9_]+`.                  |
| `type`        | yes      | `sql` or `custom`.                                 |
| `target`      | yes      | Name of a declared connection.                     |
| `depends_on`  | no       | List of step ids. Default: `[]`.                   |
| `sql`         | sql only | Inline SQL.                                        |
| `sql_file`    | sql only | Path to `.sql` file (relative to the DAG file).    |
| `handler`     | custom   | Path to a `.ts`/`.js` file with default export.    |

A `sql` step must specify exactly one of `sql` or `sql_file`. SQL runs
against `target`. For custom steps, `target` is informational — the handler
receives all connections and can use any of them.

### Variable interpolation

Two namespaces, both resolved at parse time before validation:

- `${env.NAME}` — from `process.env`. `.env` files in cwd or DAG dir are
  loaded automatically; override with `--env-file`.
- `${vars.NAME}` — from the pipeline's `vars:` block. Override or supply
  from CLI with `--var key=value` (repeatable).

`vars:` values may reference `${env.X}`. Nested `${vars.X}` references in
`vars:` are not allowed.

Unresolved references are a parse error (exit code 2).

## Custom TypeScript steps

When SQL isn't enough, write a TypeScript module with a default export.

```ts
// load_users.ts
import type { StepContext } from 'tinydag';

export default async function loadUsers(ctx: StepContext): Promise<void> {
  const duck = ctx.connections.warehouse;
  const pg = ctx.connections.results;

  const rows = await duck.query<{ id: number; email: string }>(
    'SELECT id, email FROM clean_users',
  );

  for (const row of rows) {
    if (ctx.signal.aborted) throw new Error('cancelled');
    await pg.query(
      'INSERT INTO users (id, email) VALUES ($1, $2)',
      [row.id, row.email],
    );
  }

  ctx.logger.info(`loaded ${rows.length} rows`);
}
```

Reference it from the DAG:

```yaml
- id: load_users
  type: custom
  target: results
  depends_on: [transform_users]
  handler: ./load_users.ts
```

### `StepContext`

The argument passed to your handler:

| Field           | Type                              | Description                              |
|-----------------|-----------------------------------|------------------------------------------|
| `stepId`        | `string`                          | This step's id.                          |
| `pipelineName`  | `string`                          | The pipeline's `name`.                   |
| `connections`   | `Record<string, Connection>`      | All declared connections, by name. Each is opened lazily on first use. |
| `env`           | `Readonly<Record<string, string \| undefined>>` | Frozen snapshot of `process.env`. |
| `vars`          | `Readonly<Record<string, string>>` | Resolved pipeline vars.                 |
| `logger`        | `Logger`                          | Scoped logger; messages auto-tag with step id. |
| `signal`        | `AbortSignal`                     | Fires on Ctrl-C. Custom steps **should** honour it. |

### `Connection`

```ts
interface Connection {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
  readonly raw: unknown;  // underlying client (DuckDBConnection or pg.Client)
}
```

`query` returns rows as plain JS objects (column → value). `exec` is for
statements that don't return rows (DDL, COPY, etc.). Drop down to `raw` for
connector-specific features.

### Running TypeScript handlers

By default, Node only loads `.js`. Two ways to run `.ts` handlers:

**1. Use `tsx` (no build step):**

```sh
npx tsx node_modules/tinydag/dist/cli.js run dag.yml
```

**2. Pre-compile and reference the `.js`:**

```yaml
- id: load_users
  type: custom
  target: results
  handler: ./dist/load_users.js
```

## Execution model

1. Parse YAML.
2. Resolve `${env.X}` and `${vars.X}`.
3. Validate: unique ids, all `depends_on` resolve, no cycles, all `target`s
   resolve to a declared connection, exactly one of `sql`/`sql_file` for SQL
   steps, `handler` exists for custom steps.
4. Open connections lazily — only when a step that uses one is launched.
5. Topologically schedule: every step whose dependencies are all `success`
   becomes ready and runs immediately, capped by `--concurrency` if set.
6. On step failure: mark all transitive descendants `skipped`. Independent
   branches keep running. The run exits 1 after the queue drains.
7. On Ctrl-C: cancellation propagates via `AbortSignal`. In-flight steps
   settle, remaining pending steps are skipped, connections close, exit 130.

### Step states

`pending → running → success | failed | skipped`

### Failure semantics

- A failed step skips its descendants. Sibling branches keep running.
- No retries in v1. A failed step is failed.
- Connection-open errors are pipeline-fatal: the run aborts.

## Logging

Structured under the hood, rendered colored & aligned by default
(`--log pretty`). Per step, on completion, one record:

```json
{
  "ts": "2026-04-28T10:11:12.345Z",
  "level": "info",
  "pipeline": "daily_users",
  "step": "transform_users",
  "status": "success",
  "duration_ms": 412,
  "target": "warehouse"
}
```

`--log json` emits one JSON object per line on stderr — pipe it to a log
shipper or `jq`.

## Editor support

Add this pragma to the top of your `dag.yml` to get autocomplete and
validation in VS Code (with the YAML extension) and other LSP-aware editors:

```yaml
# yaml-language-server: $schema=https://unpkg.com/tinydag/schemas/dag.schema.json
```

## Bundled examples

| Name        | What it does                                                  |
|-------------|---------------------------------------------------------------|
| `csv-merge` | Reads two CSVs into DuckDB, LEFT JOINs them, exports to JSON. |

Run a bundled example in place (writes inside the install dir, demo only):

```sh
npx tinydag example run csv-merge
```

Or scaffold one into your own dir:

```sh
npx tinydag init my-pipeline --example csv-merge
```

## Recipes

### Read a CSV from S3 / HTTP / GCS

DuckDB handles this natively — no extra connector needed.

```yaml
- id: load
  type: sql
  target: warehouse
  sql: |
    CREATE TABLE events AS
    SELECT * FROM read_csv_auto('https://example.com/events.csv');
```

### Parameterize by run date

```yaml
vars:
  run_date: ${env.RUN_DATE}

steps:
  - id: snapshot
    type: sql
    target: warehouse
    sql: |
      CREATE TABLE snap AS
      SELECT * FROM events WHERE date = '${vars.run_date}';
```

```sh
tinydag run dag.yml --var run_date=2026-04-28
```

### Cap parallelism

```sh
tinydag run dag.yml --concurrency 4
```

### Wrap with a scheduler

tinydag has no built-in scheduler. Use cron, systemd, Airflow, GitHub
Actions — anything that can invoke a CLI on a cadence.

```cron
0 5 * * * cd /opt/my-pipeline && /usr/local/bin/tinydag run dag.yml --var run_date=$(date +\%F) >> /var/log/pipeline.log 2>&1
```

## Roadmap

- v1 ships DuckDB + Postgres only. More connectors (S3 client, BigQuery,
  Snowflake, generic HTTP) are planned as separate optional peer deps.
- Per-step retries, step timeouts, conditional steps (`when:`),
  checkpoint-and-resume, and a `tinydag history` command are post-v1.
- See `SPEC.md` in the repo for the full v2 design.

## License

Apache-2.0.
