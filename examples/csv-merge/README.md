# csv-merge — bundled tinydag example

Reads two CSVs into DuckDB, merges them with a LEFT JOIN, and exports the
result to JSON. Demonstrates parallel step execution (the two loads have no
dependency on each other) and DuckDB's built-in CSV reader.

## Run

From the repo root:

```sh
pnpm install
pnpm -r build
pnpm --filter csv-merge run
```

Or, after the package is built, in place:

```sh
node ../../packages/tinydag/dist/cli.js run dag.yml
```

## Output

`output/result.json` — array of 8 user records. User id 7 (Edsger) has no
matching address, so its `street`/`city`/`country` are `null`.

## Switch to CSV output

In `dag.yml`, change the `export` step's COPY clause to:

```sql
COPY result TO 'output/result.csv' (FORMAT CSV, HEADER);
```

## Pipeline shape

```
load_users  ─┐
             ├─→ merge ─→ export
load_addresses ─┘
```

See `../../packages/tinydag/README.md` for deeper docs.
