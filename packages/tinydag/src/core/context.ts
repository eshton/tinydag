import type { Connection, Logger, Step, StepContext } from './types.js';

export function buildStepContext(args: {
  step: Step;
  pipelineName: string;
  connections: Record<string, Connection>;
  vars: Readonly<Record<string, string>>;
  logger: Logger;
  signal: AbortSignal;
}): StepContext {
  const env = Object.freeze({ ...process.env });
  return {
    stepId: args.step.id,
    pipelineName: args.pipelineName,
    connections: args.connections,
    env,
    vars: args.vars,
    logger: args.logger.child({ step: args.step.id }),
    signal: args.signal,
  };
}
