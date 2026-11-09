import { getContainerTool } from '@/features/container-tools/registry';
import { getRunner } from '@/lib/runner';
import { MODULE_LIMITS } from './module-policy';
import { validateModuleResult, type ModuleExecution } from './module-execution';

export interface ContainerModuleExecution extends ModuleExecution {
  container: {
    toolId: string;
    image: string;
    cmd: string[];
    timeoutMs: number;
  };
}

export function isContainerExecution(
  execution: ModuleExecution
): execution is ContainerModuleExecution {
  return 'container' in execution;
}

export async function executeAgentContainer(
  execution: ContainerModuleExecution,
  signal: AbortSignal,
  beforeRequest: () => Promise<void>
) {
  const bounded = AbortSignal.any([
    signal,
    AbortSignal.timeout(MODULE_LIMITS.containerTimeoutMs)
  ]);
  try {
    bounded.throwIfAborted();
    await beforeRequest();
    const tool = getContainerTool(execution.container.toolId);
    if (
      !tool ||
      tool.image !== execution.container.image ||
      !tool.supportsInput(execution.input)
    )
      throw new Error('agent_transform_unavailable');
    bounded.throwIfAborted();
    const response = await getRunner().run(execution.container, {
      signal: bounded,
      requireCancellation: true
    });
    bounded.throwIfAborted();
    await beforeRequest();
    if (response.exitCode !== 0) throw new Error('agent_container_failed');
    const result = tool.parseOutput({
      input: { entity: execution.input, config: {} },
      ...response
    });
    return validateModuleResult(result, execution);
  } catch (error) {
    if (bounded.aborted) throw new Error('agent_module_cancelled');
    if (
      error instanceof Error &&
      error.message === 'container_runner_upgrade_required'
    )
      throw new Error('agent_container_runner_upgrade_required');
    if (error instanceof Error && /^agent_[a-z_]+$/.test(error.message))
      throw error;
    throw new Error('agent_container_failed');
  }
}
