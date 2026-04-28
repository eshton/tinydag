# tinydag

A tiny, YAML-driven ETL framework for TypeScript. Define DAGs of SQL or
TypeScript steps, run them from the CLI.

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
npx tinydag run dag.yml
```

## Features

- **YAML-declarative DAGs.** One file per pipeline. Steps, deps, connections,
  variables — no boilerplate.
- **DuckDB built in.** Read CSV / JSON / Parquet from local files, HTTP, or
  S3; transform in SQL; export — no external database to set up.
- **Parallel by default.** Steps run as soon as their dependencies satisfy.
  Independent branches keep running when a sibling fails.
- **TypeScript escape hatch.** When SQL isn't enough, drop in a
  `type: custom` step backed by a function with a typed `StepContext`.
- **Optional Postgres.** Peer-dep so users who never touch it don't pay the
  install cost. Lazy-loaded with an actionable error if `pg` is missing.
- **Variable interpolation.** `${env.X}` from `process.env` (with `.env`
  auto-loaded), `${vars.X}` from the DAG file or `--var key=value` on the
  CLI.
- **Cancellable.** Ctrl-C propagates via `AbortSignal`; in-flight steps
  settle, remaining work is marked `skipped`, exit `130`.
- **Pretty + JSON logging.** Per-step structured records; pipe `--log json`
  to your shipper of choice.
- **Editor autocomplete.** Ships a JSON Schema; one pragma in your YAML and
  VS Code (with the YAML extension) gives you completion + validation.
- **Tiny.** No scheduler, no web UI, no run-history database. Wrap with
  cron / systemd / Airflow / GitHub Actions for scheduling.
- **Zero-clone scaffolding.** `npx tinydag init my-pipeline` copies a
  bundled example to a target dir; `npx tinydag example run csv-merge`
  runs one in place.

## Examples

Three bundled examples, all shipped inside the published npm tarball
under `dist/examples/<name>/`:

| Name             | What it shows                                                                                                                                                              | Runs zero-config?                                                              |
|------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------|
| `csv-merge`      | Reads two CSVs into DuckDB, LEFT JOINs them, exports to JSON. SQL-only — exercises parallel step execution and DuckDB's CSV reader.                                        | Yes — `npx tinydag example run csv-merge`                                     |
| `custom-step`    | Loads events from CSV, aggregates in DuckDB, then a TypeScript handler reads the result and writes a Markdown report. Uses `ctx.vars`, `ctx.connections`, `ctx.logger`.    | No — `.ts` handler. Use `tinydag init --example custom-step`.                 |
| `postgres-load`  | Stages messy CSV in DuckDB, cleans it with SQL, then a TS handler upserts the rows into Postgres in a transaction. Demonstrates `ON CONFLICT DO UPDATE` and `BEGIN/COMMIT`. | No — `.ts` handler + needs `PG_URL`. Use `tinydag init --example postgres-load`. |

Each example has its own README with run instructions:
- [`examples/csv-merge/README.md`](./examples/csv-merge/README.md)
- [`examples/custom-step/README.md`](./examples/custom-step/README.md)
- [`examples/postgres-load/README.md`](./examples/postgres-load/README.md)

## What's where

```
.
├── packages/tinydag/          # the published npm package — start here for usage
│   ├── README.md              # full user docs (CLI, DAG file format, custom steps, roadmap)
│   ├── AGENTS.md              # user-facing agent context (ships in the npm tarball)
│   ├── src/                   # library source
│   ├── test/                  # vitest unit tests
│   └── schemas/               # JSON Schema for editor support
├── examples/                  # bundled examples (also shipped inside the npm tarball)
│   ├── csv-merge/             # SQL-only DAG: two CSVs → DuckDB → JSON
│   ├── custom-step/           # SQL pipeline + a TypeScript handler that writes a Markdown report
│   └── postgres-load/         # DuckDB → Postgres pipeline with a transactional upsert
├── AGENTS.md                  # contributor-facing agent context (root)
└── .github/workflows/ci.yml   # build, test, run examples, release on tag
```

For usage, install the package and read [`packages/tinydag/README.md`](./packages/tinydag/README.md).

## Develop locally

```sh
pnpm install
pnpm -r build
pnpm -r test
pnpm --filter csv-merge run run    # the reference example, end-to-end
```

The example writes `examples/csv-merge/output/result.json` — a LEFT JOIN of
two CSVs, 8 rows, with one user (id 7) deliberately having `null` address
fields to exercise the join.

To run the bundled example against the *built* npm package (the same path
the published tarball takes):

```sh
node packages/tinydag/dist/cli.js example run csv-merge
```

To run the `postgres-load` example, you need a local Postgres. The
quickest path:

```sh
docker run -d --name tinydag-pg -p 5432:5432 \
  -e POSTGRES_USER=tinydag -e POSTGRES_PASSWORD=tinydag -e POSTGRES_DB=tinydag \
  postgres:16
PG_URL=postgresql://tinydag:tinydag@localhost:5432/tinydag \
  pnpm --filter postgres-load-example run run
```

To inspect the publish payload:

```sh
pnpm --filter tinydag pack --pack-destination /tmp
tar -tzf /tmp/tinydag-*.tgz
```

## Versioning & release

- Semver. v0.x while the API is unstable; v1.0.0 once the YAML schema and
  `StepContext` shape are frozen.
- CI publishes to npm on tag push (`v*`) via the `release` job in
  `.github/workflows/ci.yml`. Set the `NPM_TOKEN` repo secret first.

## License

MIT — see [LICENSE](./LICENSE).
