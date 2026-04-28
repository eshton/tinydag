import { pathToFileURL } from 'node:url';
import type { CustomHandler, CustomStep, StepContext } from '../core/types.js';

export async function runCustomStep(step: CustomStep, ctx: StepContext): Promise<void> {
  const url = pathToFileURL(step.handler).href;
  const mod = (await import(url)) as { default?: CustomHandler };
  const handler = mod.default;
  if (typeof handler !== 'function') {
    throw new Error(
      `custom step "${step.id}": handler ${step.handler} has no default export function`,
    );
  }
  await handler(ctx);
}
