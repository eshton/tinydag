# tinydag — Specification

A minimal ETL framework for TypeScript. Define DAGs in YAML, run them from the
CLI, ship as a small library with optional connector peer dependencies.

> **Status:** working spec, v0.1 design. The project directory is currently
> named `minidag` but the package is `tinydag` — rename the dir on first
> commit, or leave it; the package name is what publishes.

## 1. Goals & non-goals

**Goals**
- Tiny surface area. Each module a few hundred lines of TypeScript at most.
- DAGs are declarative YAML; logic in steps is either SQL or a TypeScript
  function.
- Optional, tree-shakeable connectors (install only what you use).
- Predictable parallel execution: any step whose dependencies are satisfied
  runs immediately.
- A self-contained example anyone can `git clone && pnpm install && pnpm run` —
  no Postgres, no Docker, no external infra.

**Non-goals (v1)**
- No scheduler — wrap with cron/systemd/Airflow if you need one.
- No web UI.
- No run-history database, no resume-from-failure.
- No connector zoo. v1 ships DuckDB + PostgreSQL only.

## 2. Mental model

- **DuckDB is the working store.** Extract and transform steps land data in
  DuckDB tables. DuckDB also handles file IO (`read_csv_auto`, `COPY ... TO`),
  so v1 needs no separate "file" connector.
- **PostgreSQL is the result store.** Optional. Load steps publish to Postgres
  when downstream systems need a real RDBMS.
- **Steps do not share in-memory data.** A step communicates with downstream
  steps only by writing to a connection (DuckDB or Postgres). Keeps the
  executor trivial and steps independently retryable in v2.
- **Each step targets exactly one connection** (`target:`). For SQL steps this
  is enforced (the SQL runs against `target`). For custom steps `target` is
  informational — the handler receives all connections and may use any of
  them. Convention: name the primary one as `target`.

## 3. Repository layout (monorepo)

pnpm workspaces. The library lives under `packages/`, runnable examples under
`examples/`. Cloning the repo gives you both, and the example resolves
`tinydag` to the local workspace via `workspace:*`.

```
tinydag/                               # repo root
├── package.json                        # private root, "workspaces": [...]
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .gitignore
├── .npmrc
├── README.md
├── SPEC.md
├── packages/
│   └── tinydag/                        # the published npm package
│       ├── package.json                # name: "tinydag", version: 0.0.0
│       ├── tsconfig.json
│       ├── tsup.config.ts
│       ├── README.md
│       ├── schemas/
│       │   └── dag.schema.json
│       ├── src/
│       │   ├── cli.ts
│       │   ├── index.ts                # public API re-exports
│       │   ├── commands/
│       │   │   ├── run.ts
│       │   │   ├── validate.ts
│       │   │   └── list.ts
│       │   ├── core/
│       │   │   ├── parse.ts
│       │   │   ├── interpolate.ts
│       │   │   ├── validate.ts
│       │   │   ├── executor.ts
│       │   │   ├── logger.ts
│       │   │   ├── context.ts
│       │   │   └── types.ts
│       │   ├── steps/
│       │   │   ├── sql.ts
│       │   │   └── custom.ts
│       │   └── connectors/
│       │       ├── index.ts
│       │       ├── duckdb.ts           # peer: @duckdb/node-api
│       │       └── postgres.ts         # peer: pg
│       └── test/
└── examples/
    └── csv-merge/
        ├── package.json                # depends on "tinydag": "workspace:*"
        ├── README.md
        ├── dag.yml
        ├── data/
        │   ├── users.csv
        │   └── addresses.csv
        ├── output/                     # gitignored
        │   └── .gitkeep
        └── .gitignore
```

### 3.1 Root files

`package.json` (root, private):
```json
{
  "name": "tinydag-monorepo",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "pnpm -r --filter ./packages/* build",
    "test": "pnpm -r --filter ./packages/* test",
    "example:csv-merge": "pnpm --filter csv-merge run"
  },
  "devDependencies": {
    "typescript": "^5.6.0"
  },
  "packageManager": "pnpm@9.0.0"
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "packages/*"
  - "examples/*"
```

`.npmrc`:
```
link-workspace-packages=true
prefer-workspace-packages=true
```

`.gitignore` (root):
```
node_modules
dist
*.log
.DS_Store
.env
.env.local
```

### 3.2 `packages/tinydag/package.json`

```json
{
  "name": "tinydag",
  "version": "0.0.0",
  "description": "A minimal DAG-based ETL framework for TypeScript.",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  },
  "bin": {
    "tinydag": "./dist/cli.js"
  },
  "files": ["dist", "schemas", "README.md"],
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "citty": "^0.1.6",
    "yaml": "^2.5.0",
    "dotenv": "^16.4.0",
    "picocolors": "^1.1.0",
    "@duckdb/node-api": "^1.1.0"
  },
  "peerDependencies": {
    "pg": "*"
  },
  "peerDependenciesMeta": {
    "pg": { "optional": true }
  },
  "devDependencies": {
    "@duckdb/node-api": "^1.1.0",
    "@types/node": "^22.0.0",
    "@types/pg": "^8.11.0",
    "pg": "^8.13.0",
    "tsup": "^8.3.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

### 3.3 `examples/csv-merge/package.json`

```json
{
  "name": "csv-merge",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "run": "tinydag run dag.yml",
    "validate": "tinydag validate dag.yml",
    "list": "tinydag list dag.yml"
  },
  "dependencies": {
    "tinydag": "workspace:*",
    "@duckdb/node-api": "^1.1.0"
  }
}
```

## 4. DAG file format

YAML. Single file per pipeline.

```yaml
name: daily_users
description: Extract users, transform, load to results store.

connections:
  warehouse:
    type: duckdb
    path: ${env.DUCKDB_PATH}
  results:
    type: postgres
    url: ${env.PG_URL}

vars:
  run_date: ${vars.run_date}   # filled by --var run_date=2026-04-28

steps:
  - id: extract_users
    type: sql
    target: warehouse
    sql: |
      CREATE OR REPLACE TABLE staging_users AS
      SELECT * FROM read_csv_auto('s3://bucket/users.csv');

  - id: transform_users
    type: sql
    target: warehouse
    depends_on: [extract_users]
    sql: |
      CREATE OR REPLACE TABLE clean_users AS
      SELECT id, lower(email) AS email FROM staging_users;

  - id: load_users
    type: custom
    target: results
    depends_on: [transform_users]
    handler: ./pipelines/load_users.ts
```

### 4.1 Top-level keys

| Key           | Required | Description                                          |
|---------------|----------|------------------------------------------------------|
| `name`        | yes      | Pipeline identifier (used in logs).                  |
| `description` | no       | Free-form.                                           |
| `connections` | yes      | Map of name → connection config.                     |
| `vars`        | no       | Pipeline variables, used via `${vars.X}`.            |
| `steps`       | yes      | Ordered list of step definitions (order is for human readability — execution order is determined by `depends_on`). |

### 4.2 Connection types

```yaml
warehouse:
  type: duckdb
  path: ./data/warehouse.duckdb     # or ":memory:"

results:
  type: postgres
  url: postgresql://user:pw@host:5432/db
  # OR component form:
  # host, port, database, user, password
```

### 4.3 Step shape

| Field         | Required | Notes                                              |
|---------------|----------|----------------------------------------------------|
| `id`          | yes      | Unique within file. `[a-z0-9_]+`.                  |
| `type`        | yes      | `sql` \| `custom`.                                 |
| `target`      | yes      | Name of a declared connection.                     |
| `depends_on`  | no       | List of step ids. Default: `[]`.                   |
| `sql`         | sql only | Inline SQL, or use `sql_file:` for an external file. |
| `sql_file`    | sql only | Path to `.sql` file (relative to DAG file).        |
| `handler`     | custom   | Path to `.ts`/`.js` file with default export.      |

## 5. Variable interpolation

Two namespaces, both resolved at parse time *before* validation:

- `${env.NAME}` — process env (`.env` files loaded automatically via `dotenv`).
- `${vars.NAME}` — pipeline `vars:` block, overridable from CLI with
  `--var key=value`.

Unresolved references are a parse error.

## 6. Custom step contract

A custom step is a TypeScript module with a default export:

```ts
import type { StepContext } from 'tinydag';

export default async function loadUsers(ctx: StepContext): Promise<void> {
  const pg = ctx.connections.results;          // typed Postgres handle
  const duck = ctx.connections.warehouse;      // typed DuckDB handle
  const rows = await duck.query('SELECT * FROM clean_users');
  await pg.query('INSERT INTO users ...', [...]);
  ctx.logger.info(`loaded ${rows.length} rows`);
}
```

`StepContext` provides:

- `connections` — map of name → connection handle (typed by connector).
- `env` — frozen `process.env` snapshot.
- `vars` — resolved pipeline vars.
- `logger` — scoped child logger (prefixes step id).
- `stepId`, `pipelineName`.
- `signal: AbortSignal` — fired when the run is cancelled (Ctrl-C). Custom
  steps SHOULD honour it.

The custom step's `target` connection is available in `connections` like any
other; `target` is informational for v1 (used in logs/UI). It is not enforced
that a custom step touch only its target.

### 6.1 Loading TypeScript handlers

Custom-step `.ts` files are loaded via dynamic `import()`. To support raw `.ts`
without a build step in user pipelines, recommend (in the README) running via
`tsx`:

```
tsx node_modules/tinydag/dist/cli.js run dag.yml
```

Or — simpler for users — they pre-compile their handlers and reference `.js`
in `handler:`. v1 supports both; the example project uses `.ts` via `tsx`.

## 7. Execution model

1. Parse YAML.
2. Resolve `${env.X}` and `${vars.X}`.
3. Validate: unique ids, all `depends_on` resolve, no cycles, all `target`s
   resolve to a declared connection, exactly one of `sql`/`sql_file` for SQL
   steps, `handler` exists for custom steps.
4. Open connections lazily (first use per connection).
5. Topological scheduling loop:
   - Maintain a set of `ready` steps (deps all `success`).
   - Launch every ready step in parallel, up to `--concurrency N` if set
     (default: unlimited).
   - On step completion, mark `success`/`failed`, recompute ready set.
   - On failure: mark all transitive downstream as `skipped`. Independent
     branches continue running.
6. After the queue drains, close all connections.
7. Exit `0` if no step failed, else `1`.

### 7.1 Step states

`pending → running → success | failed | skipped`

### 7.2 Cancellation

Ctrl-C (`SIGINT`) triggers the run's `AbortSignal`. SQL steps cancel their
in-flight query if the connector supports it; custom steps receive the signal
via `ctx.signal`. After cancellation, the executor waits for in-flight steps
to settle, marks remaining `pending` steps as `skipped`, closes connections,
exits `130`.

## 8. CLI

Built on [`citty`](https://github.com/unjs/citty).

```
tinydag run <file>          Execute a DAG.
tinydag validate <file>     Parse, resolve vars, check cycles. No execution.
tinydag list <file>         Print the step graph (id, deps, target).
tinydag init [dir]          Scaffold a minimal DAG project (default: csv-merge).
tinydag example list        List bundled example DAGs.
tinydag example run <name>  Run a bundled example end-to-end.
```

### 8.0 `init` and `example`

These two commands exist so users can go from `npx tinydag` to a working
pipeline with zero clones, copies, or scaffolding by hand.

- **`tinydag init [dir]`** copies a bundled example into `dir` (default: the
  example's name in cwd). After scaffolding, prints the next-step commands
  (e.g. `cd csv-merge && tinydag run dag.yml`). Flags:
  - `--example <name>` — which template to seed (default: `csv-merge`).
  - `--force` — overwrite an existing non-empty target dir.
- **`tinydag example list`** prints names + one-line descriptions of bundled
  examples.
- **`tinydag example run <name>`** runs a bundled example *in place* (from
  inside the package's `dist/examples/<name>/`). Useful for "does this thing
  work on my machine" smoke tests. Output files are written next to the
  example inside the npm install dir, so this is for demo, not production
  use — for real work, use `init` then `run`.

Bundled examples live at `examples/*` in the monorepo. The `tinydag` package
build copies them into `packages/tinydag/dist/examples/`, so they ship inside
the npm tarball. There is exactly one source of truth.

### 8.1 Common flags

| Flag                | Description                                              |
|---------------------|----------------------------------------------------------|
| `--env-file <path>` | dotenv file to load (default: `.env` in cwd, if exists). |
| `--var key=value`   | Override / supply a pipeline var. Repeatable.            |
| `--concurrency N`   | Cap parallel steps. Default: unlimited.                  |
| `--log <fmt>`       | `pretty` (default) \| `json`.                            |
| `--log-level <lvl>` | `debug` \| `info` \| `warn` \| `error`. Default `info`.  |

### 8.2 Exit codes

| Code | Meaning                          |
|------|----------------------------------|
| 0    | All steps succeeded.             |
| 1    | One or more steps failed.        |
| 2    | Validation / parse error.        |
| 130  | Cancelled by SIGINT.             |

## 9. Logging

Structured under the hood, rendered pretty by default. Per step, on completion,
emit one record:

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

Pretty mode collapses this to a colored, aligned line. Logs from inside custom
steps are tagged with `step` automatically via the scoped logger.

## 10. Failure semantics

- **Fail-fast for descendants only.** A failed step skips its transitive
  descendants. Sibling/independent branches keep running.
- **No retries in v1.** A failed step is failed.
- **Connection errors** during open are pipeline-fatal: the run aborts.

## 11. Dependencies

**Direct:**
- `citty` — CLI.
- `yaml` — parser (eemeli/yaml).
- `dotenv` — env file loading.
- `picocolors` — terminal colors (tiny, no deps).
- `@duckdb/node-api` — DuckDB connector. (Locked to the new "Neo" bindings;
  do not use the legacy `duckdb` package.) Bundled as a regular dep, not a
  peer, so `npx tinydag run dag.yml` works zero-config. Adds ~40–50 MB to
  the install but is justified: DuckDB is the central store and most DAGs
  use it.

**Optional peer (`peerDependenciesMeta` → optional):**
- `pg` — Postgres connector. Kept as an optional peer so users who never
  touch Postgres don't pay for the install. The connector module imports
  `pg` lazily; on first use without it, tinydag prints a clear hint:
  `Postgres connector requires "pg". Install with: npm install pg`.

**Dev:**
- `typescript`, `tsup` (build), `vitest` (tests), `@types/node`, `@types/pg`,
  `pg` (so the connector is importable in dev/test), `tsx` (for running TS
  handlers in the example).

## 12. Editor support

Ship `schemas/dag.schema.json`. Document the YAML pragma in the README:

```yaml
# yaml-language-server: $schema=https://unpkg.com/tinydag/schemas/dag.schema.json
```

Gives autocomplete + validation in VS Code (with the YAML extension) for free.

## 13. Testing strategy

- **Unit:** parser, interpolation, cycle detection, topo scheduler (with a
  fake step runner — no real DB).
- **Integration:** the `csv-merge` example IS the integration test. CI runs
  `pnpm --filter csv-merge run validate` and `… run` and asserts
  `output/result.json` exists and has the expected row count.
- **Postgres tests** (when added): gated behind a `PG_URL` env var so local
  contributors can skip them.

## 14. Versioning & release

- Semver. v0.x while API is unstable; v1.0.0 once the YAML schema and
  `StepContext` shape are frozen.
- Build with `tsup` to ESM + CJS + `.d.ts`.
- Build also copies `examples/*` from the monorepo root into
  `packages/tinydag/dist/examples/` (e.g. via a tsup `onSuccess` hook or a
  small `prepublishOnly` script). The `files` field already includes `dist`,
  so examples ship with the published tarball.
- Publish via GitHub Actions on tag push (`v*`). Release workflow runs
  `pnpm -r build` then `pnpm publish --filter tinydag`.

## 15. Install paths & quick-start UX

Two supported ways to use `tinydag`. Both should be documented in the
package README's "Quick start", in this order:

### 15.1 Zero-install (npx) — for SQL-only DAGs

```sh
# try the bundled example end-to-end
npx tinydag example run csv-merge

# scaffold your own pipeline from that example
npx tinydag init my-pipeline
cd my-pipeline
npx tinydag run dag.yml
```

This path requires no `package.json`, no clone, no local install. DuckDB is
bundled, so `read_csv_auto`, `COPY`, and any in-database SQL just work. Best
fit for: ad-hoc data wrangling, one-off ETL scripts, demos, exploration.

### 15.2 Local install — for projects with custom TS steps

```sh
mkdir my-pipeline && cd my-pipeline
npm init -y
npm install tinydag
# add custom TS steps that import { StepContext } from 'tinydag'
npx tinydag run dag.yml
```

Required when the DAG has `type: custom` steps, because the handler `.ts`
file does `import type { StepContext } from 'tinydag'` and that import has
to resolve to a local installation.

If the DAG also targets Postgres, add `npm install pg` here too. tinydag
prints an actionable message if it's missing.

### 15.3 Picking between them

| You want to…                          | Use                  |
|---------------------------------------|----------------------|
| Run a YAML DAG that's only SQL        | npx / global install |
| Use custom TypeScript step handlers   | Local `npm install`  |
| Load data into Postgres               | Local install + `pg` |
| Quickly demo tinydag to someone       | `npx tinydag example run csv-merge` |

The README should state plainly: **the global/npx path is intentionally
limited to SQL-only DAGs.** Mixing TS handlers with a global install leads
to module-resolution headaches and is not supported.

---

# 16. Example project: `csv-merge`

The reference example. Read two CSVs into DuckDB, merge them, export merged
result as JSON. No Postgres, no infra. Demonstrates parallel step execution
(the two loads have no dependency on each other), DuckDB file IO, and the
DAG dependency model.

### 16.1 Data files (committed, hand-written)

`examples/csv-merge/data/users.csv`:
```csv
id,name,email
1,Ada Lovelace,ada@example.com
2,Alan Turing,alan@example.com
3,Grace Hopper,grace@example.com
4,Linus Torvalds,linus@example.com
5,Margaret Hamilton,margaret@example.com
6,Donald Knuth,donald@example.com
7,Edsger Dijkstra,edsger@example.com
8,Barbara Liskov,barbara@example.com
```

`examples/csv-merge/data/addresses.csv`:
```csv
user_id,street,city,country
1,12 Lambeth Walk,London,UK
2,5 Kings College Lane,Cambridge,UK
3,1500 Massachusetts Ave,Washington,USA
4,123 Linux Way,Portland,USA
5,77 Apollo Rd,Cambridge,USA
6,1 University Dr,Stanford,USA
8,77 Mass Ave,Cambridge,USA
```

User 7 (Edsger) deliberately has no address — exercises the LEFT JOIN and
NULL handling on output.

### 16.2 DAG file

`examples/csv-merge/dag.yml`:
```yaml
# yaml-language-server: $schema=../../packages/tinydag/schemas/dag.schema.json
name: csv-merge
description: Read users + addresses from CSV, merge in DuckDB, export to JSON.

connections:
  warehouse:
    type: duckdb
    path: ":memory:"

steps:
  - id: load_users
    type: sql
    target: warehouse
    sql: |
      CREATE TABLE users AS
      SELECT * FROM read_csv_auto('data/users.csv');

  - id: load_addresses
    type: sql
    target: warehouse
    sql: |
      CREATE TABLE addresses AS
      SELECT * FROM read_csv_auto('data/addresses.csv');

  - id: merge
    type: sql
    target: warehouse
    depends_on: [load_users, load_addresses]
    sql: |
      CREATE TABLE result AS
      SELECT
        u.id,
        u.name,
        u.email,
        a.street,
        a.city,
        a.country
      FROM users u
      LEFT JOIN addresses a ON a.user_id = u.id
      ORDER BY u.id;

  - id: export
    type: sql
    target: warehouse
    depends_on: [merge]
    sql: |
      COPY result TO 'output/result.json' (FORMAT JSON, ARRAY true);
```

Execution:
```
load_users  ─┐
             ├─→ merge ─→ export
load_addresses ─┘
```
The two loads run concurrently. `merge` waits for both. `export` waits for
`merge`.

### 16.3 README (`examples/csv-merge/README.md`)

Should cover, briefly:
- One-paragraph what-this-does.
- Run command: `pnpm install` (at repo root) then `pnpm --filter csv-merge run`.
- Where to find the output: `output/result.json`.
- How to swap to CSV output: change the `export` step's COPY to
  `(FORMAT CSV, HEADER)` and rename to `.csv`.
- A pointer to the SPEC and main package README for deeper docs.

### 16.4 `.gitignore` for the example

`examples/csv-merge/.gitignore`:
```
output/*
!output/.gitkeep
```

---

# v2 (deferred)

Listed here so v1 design stays compatible.

## Retries
Per-step retry policy in YAML:
```yaml
- id: load_users
  retries:
    attempts: 3
    backoff: exponential   # | linear | constant
    initial_ms: 1000
```
Implies a step-attempt log record. The executor change is small.

## Checkpointing & resume
Persist run state (which steps succeeded) to a sidecar SQLite/DuckDB file.
`tinydag run dag.yml --resume <run-id>` skips already-succeeded steps.
Requires deterministic step idempotency, which is on the user.

## Step timeouts
`timeout_ms` per step; abort signal fires when exceeded.

## Conditional steps
```yaml
- id: backfill
  when: ${vars.mode} == "backfill"
```
Skipped (not failed) when condition is false.

## Hooks
`on_failure`, `on_success` step hooks at pipeline level (e.g. notify Slack).

## More connectors
S3, BigQuery, Snowflake, MongoDB, generic HTTP. Each is a separate optional
peer dep.

## Scheduling
Built-in cron daemon (`tinydag schedule`). Probably unnecessary — most users
have a scheduler already — but cheap if we want it.

## Run history
A `tinydag history` command backed by the v2 checkpoint store: list past runs,
show step timings, surface failures.

## Web UI
DAG visualization + live run view. Out-of-process; reads from the run-history
store.

## Parameterized / sub-DAGs
Call a DAG from another DAG with a vars override.

## In-memory data passing
Currently steps coordinate only through the database. v2 could add an
opt-in `output:` / `input:` mechanism for small values (counts, timestamps),
serialized through the run store.

## More example projects
Postgres-load example (gated on a local Postgres), an S3-extract example, a
custom-TS-step example showing data validation between stages.

---

# 17. Bootstrap order (suggested first commits)

When you start the implementation, this order keeps you on a working
foundation at every step:

1. **Repo skeleton.** Root `package.json`, `pnpm-workspace.yaml`, `.npmrc`,
   `tsconfig.base.json`, `.gitignore`, `README.md`. Run `pnpm install` —
   should succeed with no workspaces yet.
2. **Empty `packages/tinydag` package.** `package.json`, `tsconfig.json`,
   `tsup.config.ts`, `src/index.ts` exporting nothing. Build should pass.
3. **Empty `examples/csv-merge` package** with `tinydag: workspace:*`.
   `pnpm install` should link it.
4. **Core types + parser** (`core/types.ts`, `core/parse.ts`). No execution
   yet; `tinydag validate` works against a static fixture.
5. **Cycle detection + ref validation** (`core/validate.ts`).
6. **Variable interpolation** (`core/interpolate.ts`).
7. **CLI scaffolding** (`cli.ts`, `commands/validate.ts`, `commands/list.ts`).
   Wire to citty. Validation works end-to-end on a real DAG file.
8. **DuckDB connector** + **SQL step runner**. Single-step DAGs run.
9. **Executor with parallel scheduling**. Multi-step DAGs with deps run
   correctly in parallel.
10. **Custom step runner** + `StepContext`.
11. **Logger** (pretty + json).
12. **Cancellation / SIGINT plumbing.**
13. **CSV files + `dag.yml` for `csv-merge`.** End-to-end run produces
    `output/result.json` from the workspace example.
14. **Build pipeline copies `examples/*` → `dist/examples/`.** Verify the
    files land in the published tarball (`pnpm pack --filter tinydag` then
    inspect).
15. **`tinydag example list` + `tinydag example run`.** Smoke-test by
    running `node packages/tinydag/dist/cli.js example run csv-merge`
    against the *built* package, not the workspace.
16. **`tinydag init`.** Copies a bundled example to a target dir; verify it
    runs from there.
17. **Postgres connector** (last; optional, not used in any example).
    Confirm the missing-`pg` error message is helpful.
18. **JSON Schema for editor support.**
19. **CI** running `pnpm build`, unit tests, and `tinydag example run csv-merge`
    end-to-end against the built package.

Don't move past step 13 without the workspace example running green, and
don't move past step 15 without the *bundled* example running green from a
packed tarball — those two checkpoints are your v1 acceptance gates.
