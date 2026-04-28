# AGENTS.md (package — user-facing)

Context for AI agents working in a project that uses `tinydag`.

If you're working on tinydag *itself* (i.e. inside the tinydag monorepo),
the repo root has its own `AGENTS.md` aimed at contributors. This file is
the one that ships in the published npm tarball.

## What tinydag is

A YAML-driven ETL framework. The user defines a DAG (steps, dependencies,
connections) in `dag.yml`, then runs it via the CLI. Steps are either
SQL (against a DuckDB or Postgres connection) or custom TypeScript
functions. Steps run in parallel as soon as their dependencies satisfy.

## Quick start

A minimal pipeline:

```yaml
# dag.yml
name: hello
connections:
  warehouse:
    type: duckdb
    path: ":memory:"
steps:
  - id: load
    type: sql
    target: warehouse
    sql: CREATE TABLE rows AS SELECT * FROM range(10) AS t(n);
  - id: export
    type: sql
    target: warehouse
    depends_on: [load]
    sql: COPY rows TO 'rows.json' (FORMAT JSON, ARRAY true);
```

```sh
tinydag run dag.yml
```

## Mental model (load-bearing)

- **DuckDB is the working store.** Read CSV/JSON/Parquet from local files,
  HTTP, or S3 with `read_csv_auto` / `read_parquet`. No external DB needed
  for most pipelines.
- **Postgres is the optional result store.** Used when downstream systems
  need a real RDBMS. Requires `npm install pg`.
- **Steps don't share in-memory data.** A step writes to a connection;
  downstream steps read from a connection. There's no return value
  passed between steps.
- **Each step targets one connection** (`target:`). For SQL steps this is
  enforced. For custom steps `target` is informational; the handler
  receives all connections.

## DAG file format

| Top-level key | Required | Notes                                          |
|---------------|----------|------------------------------------------------|
| `name`        | yes      | Pipeline identifier; appears in logs.          |
| `description` | no       | Free-form.                                     |
| `connections` | yes      | Map of name → connection config.               |
| `vars`        | no       | Pipeline variables (strings only).             |
| `steps`       | yes      | List of step definitions.                      |

| Step field    | Required | Notes                                            |
|---------------|----------|--------------------------------------------------|
| `id`          | yes      | Unique within file. `[a-z0-9_]+`.                |
| `type`        | yes      | `sql` or `custom`.                               |
| `target`      | yes      | Name of a declared connection.                   |
| `depends_on`  | no       | List of step ids. Default: `[]`.                 |
| `sql`         | sql only | Inline SQL.                                      |
| `sql_file`    | sql only | Path to `.sql` file (relative to the DAG file). |
| `handler`     | custom   | Path to `.ts`/`.js` file with default export.    |

A SQL step needs **exactly one** of `sql` or `sql_file`. Both or neither
is a parse error.

JSON Schema for editor autocomplete is shipped with the package. Add this
pragma to the top of `dag.yml`:

```yaml
# yaml-language-server: $schema=https://unpkg.com/tinydag/schemas/dag.schema.json
```

## Variable interpolation

```yaml
connections:
  results:
    type: postgres
    url: ${env.PG_URL}        # from process.env (and .env files)

vars:
  run_date: ${env.RUN_DATE}   # vars can reference env, but not other vars

steps:
  - id: snapshot
    type: sql
    target: warehouse
    sql: SELECT * FROM events WHERE date = '${vars.run_date}';
```

Override or supply vars from the CLI: `--var run_date=2026-04-28` (repeatable).

`${vars.X}` and `${env.X}` are also substituted inside `sql_file:`
contents, so a `.sql` file behaves identically to inline `sql:` for
parameterization.

## Custom TypeScript steps

```ts
import type { StepContext } from 'tinydag';

export default async function loadUsers(ctx: StepContext): Promise<void> {
  const duck = ctx.connections.warehouse;
  const rows = await duck.query<{ id: number; email: string }>(
    'SELECT id, email FROM clean_users',
  );
  for (const row of rows) {
    if (ctx.signal.aborted) throw new Error('cancelled');
    // ... do something with row
  }
  ctx.logger.info(`processed ${rows.length} rows`);
}
```

`StepContext` provides:
- `connections` — map of name → `Connection` (with `query<T>(sql, params?): Promise<T[]>`, `exec(sql)`, `close()`, `raw` for the underlying client)
- `vars` — resolved pipeline vars
- `env` — frozen `process.env` snapshot
- `logger` — scoped logger; messages auto-tag with step id
- `signal` — `AbortSignal` that fires on Ctrl-C; honour it in long loops
- `stepId`, `pipelineName`

The handler must be the **default export** of the module. Reference it
from the DAG via `handler: ./path/to/handler.ts` (relative to the DAG
file).

To run `.ts` handlers, invoke the CLI under `tsx` (`tsx node_modules/tinydag/dist/cli.js run dag.yml`) — Node can't load `.ts` natively. Or pre-compile to `.js` and reference the built file.

## Common mistakes to avoid

- **Cycle in `depends_on`.** Validation catches it; exit code 2.
- **Both `sql` and `sql_file` set on a SQL step.** Pick one.
- **`vars.X` referencing another `${vars.Y}`.** Not supported — vars can
  only reference `${env.X}`.
- **Forgetting to install `pg`** when using a Postgres connection. Error
  message points the right way: `npm install pg`.
- **Trying to run a `.ts` handler with plain `node` / `tinydag run`.** Use
  `tsx` or pre-compile.
- **Assuming `ctx.connections.X` is open before the step that targets it
  runs.** Connections open lazily on first use. Custom steps that touch
  multiple connections may want to query them in dependency order.
- **Returning a value from a custom handler.** Return value is ignored;
  side-effects (DB writes, file writes) are how steps communicate.
- **Using `--var` for non-string types.** Vars are strings. Cast in your
  SQL or handler if you need a number.

## CLI cheat sheet

```
tinydag run <file>           Execute a DAG.
tinydag validate <file>      Parse + check structure (no execution). Exit 0/2.
tinydag list <file>          Print the step graph.
tinydag init [dir]           Scaffold from a bundled example. Flags: --example, --force.
tinydag example list         List bundled examples.
tinydag example run <name>   Run a bundled example in place (SQL-only examples).
```

Common flags on `run` / `validate` / `list`:
- `--env-file <path>` — dotenv file (default: `.env` in cwd, if present)
- `--var key=value` — repeatable
- `--concurrency N` — cap on parallel steps (default: unlimited)
- `--log pretty|json` — log format
- `--log-level debug|info|warn|error` — verbosity

Exit codes: `0` success, `1` step failure, `2` parse/validate error,
`130` cancelled by SIGINT.

## When proposing changes to a tinydag-using project

- New step? Decide `sql` vs `custom`. Prefer SQL when possible — it stays
  in DuckDB, doesn't need a `.ts` build step, and works under `npx tinydag`.
- New connection? Add it to `connections:`, then `target:` it from steps.
- New parameter? Add to `vars:` with an `${env.X}` default; document
  overriding via `--var key=value`.
- Long-running custom step? Honour `ctx.signal` so Ctrl-C works.
- Need data between steps? Write to a DuckDB table, then read it from
  the next step. Don't try to return values.

## Where to learn more

- `README.md` (in the package) — full user docs, install paths, recipes
- `schemas/dag.schema.json` — formal DAG file schema
- The `tinydag list dag.yml` command — best way to confirm you understand
  what a pipeline does
