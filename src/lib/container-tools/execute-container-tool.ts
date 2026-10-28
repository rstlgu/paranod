import { getContainerTool } from '@/features/container-tools/registry';
import type { TransformInput, TransformResult } from '@/features/plugins/types';
import { getRunner } from '@/lib/runner';

export async function executeContainerTool(args: {
  toolId: string;
  input: TransformInput;
}): Promise<TransformResult> {
  const tool = getContainerTool(args.toolId);
  if (!tool)
    return { success: false, entities: [], edges: [], error: 'Tool not found' };

  if (!tool.supportsInput(args.input.entity))
    return {
      success: false,
      entities: [],
      edges: [],
      error: 'Input type not supported'
    };

  const timeoutMs = Number(process.env.CONTAINER_TOOLS_TIMEOUT_MS ?? 180_000);

  try {
    const cmd = tool.buildCommand({ input: args.input });
    const execRes = await getRunner().run({
      image: tool.image,
      cmd,
      timeoutMs
    });

    const result = tool.parseOutput({
      input: args.input,
      exitCode: execRes.exitCode,
      output: execRes.output
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Execution failed';
    return { success: false, entities: [], edges: [], error: message };
  }
}
