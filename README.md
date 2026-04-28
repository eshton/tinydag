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

## What's where

```
.
├── packages/tinydag/          # the published npm package — start here for usage
│   ├── README.md              # full user docs (CLI, DAG file format, custom steps)
│   ├── src/                   # library source
│   ├── test/                  # vitest unit tests
│   └── schemas/               # JSON Schema for editor support
├── examples/csv-merge/        # the reference example, also bundled into the npm tarball
├── SPEC.md                    # design + v2 roadmap
└── .github/workflows/ci.yml   # build, test, run example, release on tag
```

For usage, install the package and read [`packages/tinydag/README.md`](./packages/tinydag/README.md).

For design notes and the v2 roadmap, see [`SPEC.md`](./SPEC.md).

## Develop locally

```sh
pnpm install
pnpm -r build
pnpm -r test
pnpm --filter csv-merge run    # the reference example, end-to-end
```

The example writes `examples/csv-merge/output/result.json` — a LEFT JOIN of
two CSVs, 8 rows, with one user (id 7) deliberately having `null` address
fields to exercise the join.

To run the bundled example against the *built* npm package (the same path
the published tarball takes):

```sh
node packages/tinydag/dist/cli.js example run csv-merge
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
