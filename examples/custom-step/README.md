# custom-step — bundled tinydag example

Demonstrates a `type: custom` TypeScript step. Loads events from a CSV,
aggregates them in DuckDB with SQL, then hands off to a TS handler that
reads the aggregates back, formats a Markdown report, and writes it to
disk. Also exercises pipeline `vars:` (passed to the handler via
`ctx.vars`) and the scoped logger (`ctx.logger.info`/`warn`).

## Run

From the repo root:

```sh
pnpm install
pnpm -r build
pnpm --filter custom-step-example run run
```

## Output

`output/report.md` — a Markdown report listing each event category and
its count. Categories below `vars.warning_threshold` (default `5`) get a
"Warnings" section.

Override the threshold:

```sh
pnpm --filter custom-step-example exec tsx node_modules/tinydag/dist/cli.js \
  run dag.yml --var warning_threshold=10
```

## Pipeline shape

```
load_events ─→ aggregate ─→ report (custom TS)
```

## Why `tsx`?

Node only loads `.js` natively. For raw `.ts` handlers without a separate
build step, the example invokes the CLI under `tsx`, which transpiles
`.ts` files on the fly. The script `run` in `package.json` is:

```
tsx node_modules/tinydag/dist/cli.js run dag.yml
```

If you'd rather pre-compile your handlers, set `handler:` in the DAG to
the built `.js` path and run with plain `tinydag run dag.yml`.

See `../../SPEC.md` and `../../packages/tinydag/README.md` for deeper docs.
