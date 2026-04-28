import type { Connection, DagFile, Logger, RunResult, Step, StepState } from './types.js';
import { openConnection } from '../connectors/index.js';
import { runSqlStep } from '../steps/sql.js';
import { runCustomStep } from '../steps/custom.js';
import { buildStepContext } from './context.js';

export interface ExecuteOptions {
  concurrency?: number;
  signal?: AbortSignal;
  logger: Logger;
}

/**
 * Topological scheduler. Steps with all deps `success` are launched in
 * parallel up to `concurrency`. On failure, transitive descendants are
 * skipped. On signal abort, remaining pending steps are marked skipped after
 * in-flight ones settle.
 */
export async function execute(dag: DagFile, opts: ExecuteOptions): Promise<RunResult> {
  const { logger } = opts;
  const concurrency = opts.concurrency ?? Number.POSITIVE_INFINITY;
  const signal = opts.signal ?? new AbortController().signal;

  const stepsById = new Map<string, Step>(dag.steps.map((s) => [s.id, s]));
  const dependents = buildDependentsMap(dag.steps);

  const states = new Map<string, StepState>();
  for (const s of dag.steps) states.set(s.id, 'pending');

  const remainingDeps = new Map<string, number>();
  for (const s of dag.steps) remainingDeps.set(s.id, s.depends_on.length);

  const connections: Record<string, Connection> = {};
  const opening = new Map<string, Promise<Connection>>();

  async function getConnection(name: string): Promise<Connection> {
    if (connections[name]) return connections[name]!;
    let pending = opening.get(name);
    if (!pending) {
      const spec = dag.connections[name];
      if (!spec) throw new Error(`unknown connection "${name}"`);
      logger.debug(`opening connection`, { connection: name, type: spec.type });
      pending = openConnection(spec).then((c) => {
        connections[name] = c;
        return c;
      });
      opening.set(name, pending);
    }
    return pending;
  }

  let cancelled = false;
  const ready: Step[] = [];
  const inFlight = new Set<Promise<void>>();

  function refillReady() {
    if (cancelled) return;
    for (const s of dag.steps) {
      if (states.get(s.id) !== 'pending') continue;
      if ((remainingDeps.get(s.id) ?? 0) > 0) continue;
      if (!ready.includes(s)) ready.push(s);
    }
  }

  function markSkippedDescendants(failedId: string) {
    const queue = [...(dependents.get(failedId) ?? [])];
    while (queue.length > 0) {
      const id = queue.shift()!;
      const cur = states.get(id);
      if (cur === 'pending') {
        states.set(id, 'skipped');
        const step = stepsById.get(id)!;
        logger.step({
          pipeline: dag.name,
          step: id,
          status: 'skipped',
          duration_ms: 0,
          target: step.target,
        });
        for (const child of dependents.get(id) ?? []) queue.push(child);
      }
    }
  }

  async function runOne(step: Step): Promise<void> {
    states.set(step.id, 'running');
    const start = Date.now();
    const childLogger = logger.child({ step: step.id });
    childLogger.debug('running');
    try {
      const ctx = buildStepContext({
        step,
        pipelineName: dag.name,
        connections,
        vars: dag.vars,
        logger,
        signal,
      });
      // Open the target connection lazily (and add to ctx in-place).
      await getConnection(step.target);

      // For custom steps, also expose any other connections that get touched —
      // but we open lazily, so for simplicity preopen all referenced
      // connections at first reach. Custom step handlers can call
      // ctx.connections[name], which has whatever has been opened so far.
      // Keep simple: only target is guaranteed open; others will be opened by
      // the executor when their owning step runs.

      if (step.type === 'sql') {
        await runSqlStep(step, ctx, connections[step.target]!);
      } else {
        await runCustomStep(step, ctx);
      }

      states.set(step.id, 'success');
      logger.step({
        pipeline: dag.name,
        step: step.id,
        status: 'success',
        duration_ms: Date.now() - start,
        target: step.target,
      });
    } catch (err) {
      states.set(step.id, 'failed');
      logger.step({
        pipeline: dag.name,
        step: step.id,
        status: 'failed',
        duration_ms: Date.now() - start,
        target: step.target,
        error: (err as Error).message,
      });
      markSkippedDescendants(step.id);
    } finally {
      // Decrement remaining-deps for downstream steps regardless of success —
      // skipped descendants are already terminal so this is a no-op for them.
      for (const dep of dependents.get(step.id) ?? []) {
        const cur = remainingDeps.get(dep) ?? 0;
        if (cur > 0) remainingDeps.set(dep, cur - 1);
      }
    }
  }

  function onAbort() {
    cancelled = true;
    logger.warn('cancellation requested, waiting for in-flight steps to settle');
  }
  if (signal.aborted) onAbort();
  else signal.addEventListener('abort', onAbort, { once: true });

  refillReady();

  while (ready.length > 0 || inFlight.size > 0) {
    if (cancelled && inFlight.size === 0) break;

    while (!cancelled && ready.length > 0 && inFlight.size < concurrency) {
      const step = ready.shift()!;
      const p = runOne(step).finally(() => {
        inFlight.delete(p);
      });
      inFlight.add(p);
    }

    if (inFlight.size === 0) break;
    await Promise.race([...inFlight]);
    refillReady();
  }

  if (cancelled) {
    for (const s of dag.steps) {
      if (states.get(s.id) === 'pending') {
        states.set(s.id, 'skipped');
        logger.step({
          pipeline: dag.name,
          step: s.id,
          status: 'skipped',
          duration_ms: 0,
          target: s.target,
        });
      }
    }
  }

  // Close all opened connections.
  for (const [name, conn] of Object.entries(connections)) {
    try {
      await conn.close();
    } catch (err) {
      logger.warn(`failed to close connection ${name}`, { error: (err as Error).message });
    }
  }

  const finalStates: Record<string, StepState> = {};
  const failed: string[] = [];
  for (const [id, st] of states.entries()) {
    finalStates[id] = st;
    if (st === 'failed') failed.push(id);
  }

  return {
    pipeline: dag.name,
    states: finalStates,
    failed,
    cancelled,
  };
}

function buildDependentsMap(steps: Step[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const s of steps) out.set(s.id, []);
  for (const s of steps) {
    for (const dep of s.depends_on) {
      const list = out.get(dep);
      if (list) list.push(s.id);
    }
  }
  return out;
}
