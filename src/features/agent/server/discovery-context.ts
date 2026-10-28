import type { AgentInputItem } from '@openai/agents';

/** Trim only rediscoverable catalog data, never graph evidence or approvals.
 * Tool calls/results remain paired and the SDK's stored run state is untouched.
 */
export function trimDiscoveryContext(
  items: AgentInputItem[]
): AgentInputItem[] {
  const failed = (item: AgentInputItem) =>
    item.type === 'function_call_result' &&
    JSON.stringify(item.output).includes('The tool failed (');
  const keys = new Map<string, string>();
  for (const item of items) {
    if (
      item.type !== 'function_call' ||
      !['list_modules', 'describe_module'].includes(item.name)
    )
      continue;
    try {
      const args = JSON.parse(item.arguments);
      keys.set(
        item.callId,
        JSON.stringify(
          item.name === 'list_modules'
            ? [item.name, args.inputType, args.query ?? '', args.offset ?? 0]
            : [item.name, args.inputType, args.moduleId, args.transformId]
        )
      );
    } catch {
      /* Malformed calls retain their error result. */
    }
  }
  const seen = new Set<string>();
  const counts: Record<string, number> = {
    list_modules: 0,
    describe_module: 0
  };
  const keep = new Set<string>();
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (
      item.type !== 'function_call_result' ||
      item.status !== 'completed' ||
      failed(item)
    )
      continue;
    const key = keys.get(item.callId);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const max = item.name === 'list_modules' ? 2 : 6;
    if ((counts[item.name] ?? max) < max) {
      counts[item.name]++;
      keep.add(item.callId);
    }
  }
  return items.map((item) => {
    if (
      item.type !== 'function_call_result' ||
      item.status !== 'completed' ||
      failed(item) ||
      !keys.has(item.callId) ||
      keep.has(item.callId)
    )
      return item;
    return {
      ...item,
      output: `Older ${item.name} catalog data omitted to save context. Use the original call arguments to retrieve it again if needed. This is not a new tool execution.`
    };
  });
}
