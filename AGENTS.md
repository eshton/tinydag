# AGENTS.md (repo root — contributor-facing)

Context for an agent working **on** tinydag itself.

The repo has a second `AGENTS.md` at `packages/tinydag/AGENTS.md` — that
one is **user-facing** (ships in the published npm tarball) and explains
how a project that *consumes* tinydag should look. If your cwd is inside
`packages/tinydag/`, both files are relevant; this one explains the build
and the gotchas, the other explains the public contract.

## What this is

A tiny YAML-driven ETL framework for TypeScript. DAGs of SQL or TypeScript
steps, run from a CLI. Published as `tinydag` on npm. DuckDB-first;
Postgres optional via peer dep. v0.x while the API stabilizes; v1.0.0
freezes the YAML schema and `StepContext` shape.

User-facing docs are in `packages/tinydag/README.md`. The root `README.md`
is the project landing page.

## Repo layout

```
packages/tinydag/
├── src/
│   ├── cli.ts                     # citty bin (ESM only)
│   ├── index.ts                   # public type re-exports
│   ├── core/
│   │   ├── parse.ts               # YAML + dotenv loader
│   │   ├── interpolate.ts         # ${env.X} / ${vars.X} resolution
│   │   ├── validate.ts            # ids, deps, cycles, shape
│   │   ├── executor.ts            # parallel topo scheduler, lazy conn open
│   │   ├── logger.ts              # pretty + json formats
│   │   ├── context.ts             # StepContext builder
│   │   └── types.ts               # all public types
│   ├── steps/{sql,custom}.ts      # step runners
│   ├── connectors/{duckdb,postgres,index}.ts
│   └── commands/{run,validate,list,init,example}.ts
├── test/                          # vitest, fast (no real Postgres)
├── schemas/dag.schema.json        # for editor autocomplete
├── tsup.config.ts                 # split: lib (ESM+CJS), CLI (ESM only)
├── AGENTS.md                      # user-facing — ships in the npm tarball
└── README.md                      # full user docs

examples/
├── csv-merge/      # SQL-only; bundled in tarball; runnable via `tinydag example run`
└── custom-step/    # TS handler via tsx; bundled but only usable via `tinydag init`

.github/workflows/ci.yml           # build/test/example matrix; release on tag push
```

## Build / test / run

```sh
pnpm install                                      # also runs tinydag's prepare → tsup
pnpm -r typecheck                                 # tsc --noEmit across workspaces
pnpm -r build                                     # tsup
pnpm -r test                                      # vitest (29 tests, ~1s)
pnpm --filter csv-merge run run                   # workspace example, SQL-only
pnpm --filter custom-step-example run run         # workspace example, TS handler
node packages/tinydag/dist/cli.js example run csv-merge   # bundled-tarball path
pnpm --filter tinydag pack --pack-destination /tmp        # inspect publish payload
```

CI runs all of the above on Ubuntu + macOS × Node 22 + 24.

## Gotchas (things to know before changing code)

These each represent a real bug we hit; please don't undo them.

- **`prepare: tsup` in `packages/tinydag/package.json` is load-bearing.**
  On a fresh `pnpm install`, pnpm refuses to create
  `node_modules/.bin/tinydag` (the workspace-bin shim) when `dist/cli.js`
  doesn't exist yet — and pnpm doesn't go back and re-link bins after a
  later build. The `prepare` script makes pnpm build the package during
  install, so the bin source exists in time. Removing `prepare` breaks
  the workspace examples on first clone.

- **Connection open is a promise cache, not a result cache.**
  `core/executor.ts:getConnection` stores the in-flight `Promise<Connection>`
  in a Map. Without this, two parallel steps targeting the same connection
  each call `openConnection` simultaneously, both observe "not opened yet,"
  and end up with two separate DuckDB `:memory:` instances. The merge step
  then queries one instance that has only one of the two upstream tables.

- **`@duckdb/node-api` versions use `-r.N` prerelease tags** (currently
  `1.5.2-r.1`). `^1.x.y` ranges don't resolve cleanly with these tags;
  pin the exact version. Bumping requires reading the DuckDB Node release
  notes and pinning the new tag explicitly.

- **The CLI is ESM-only; the library is dual ESM+CJS.** `tsup.config.ts`
  exports an array of two configs to make this work. Merging them back
  into one config triggers an `import.meta` warning in the CJS build of
  `commands/example.ts`.

- **`tinydag example run <name>` only works for SQL-only examples.** Node
  can't `import()` a `.ts` file natively. The `custom-step` example is
  documented as use-via-`tinydag init` only — the CLI does not currently
  detect this case and emit a friendlier error.

- **Postgres connector has real implementation but no integration tests
  in v1.** Spec was explicit about Postgres tests being gated on a
  `PG_URL` env var "when added." Be aware when changing
  `connectors/postgres.ts` that the test surface is types-only.

- **`tsconfig.json` has `noEmit: true` and includes `test/**/*`.** Don't
  set `rootDir: "src"` — it conflicts with the test folder being inside
  the package.

- **Bundled examples are copied via tsup `onSuccess`** in `tsup.config.ts`.
  Single source of truth lives at `examples/*` in the workspace; build
  copies them to `packages/tinydag/dist/examples/`. Don't duplicate
  example data anywhere else.

## Conventions

- TypeScript: `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`.
  Type-only imports must use `import type`.
- File extensions on imports: always `.js` (matches the build output).
- No comments unless the *why* is non-obvious. Don't write a comment that
  just restates the code.
- New public types go in `core/types.ts` and are re-exported from
  `src/index.ts`.
- New CLI commands go in `src/commands/` and are wired into
  `src/cli.ts`'s `subCommands` map.
- Step states are exactly: `pending | running | success | failed | skipped`.
- Exit codes: `0` success, `1` step failure, `2` parse/validate error,
  `130` SIGINT.

## Release

Tag-driven via `.github/workflows/ci.yml` `release` job. Bump
`packages/tinydag/package.json` version + `src/cli.ts` version meta, push,
then `git tag vX.Y.Z && git push origin vX.Y.Z`. Requires `NPM_TOKEN`
secret on the repo. Manual publish via `pnpm --filter tinydag publish`
also works.

## Where to find context

- User docs / API reference: `packages/tinydag/README.md`
- User-agent context: `packages/tinydag/AGENTS.md`
- Roadmap (v2 deferred items): the Roadmap section of the package README
- Commit history: every gotcha listed above corresponds to a commit
  message that explains the bug it fixed
