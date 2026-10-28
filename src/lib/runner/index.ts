/** Execute container tools through the local Docker runner. */
import { LocalDockerRunner } from './local-runner';
import type { Runner } from './types';
export type { Runner, RunnerJob, RunnerResult } from './types';
let cached: Runner | null = null;
export function getRunner(): Runner {
  cached ??= new LocalDockerRunner();
  return cached;
}
