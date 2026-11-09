import type { AgentActivity } from '@/features/agent/store/agent-activity-store';
import type {
  TransformConsoleEntry,
  TransformLog
} from '../contexts/transform-logger-context';

export function projectAgentTransforms({
  run,
  events,
  complete
}: AgentActivity) {
  const logs = new Map<string, TransformLog>();
  const entries: TransformConsoleEntry[] = [];
  for (const event of events) {
    const data = event.data;
    if (data.type !== 'tool' || data.name !== 'run_transform') continue;
    const id = `agent:${run.id}:${data.callId}`;
    const previous = logs.get(id);
    const [pluginName, ...parts] = data.target.split('/');
    const at = Date.parse(event.createdAt);
    const source = `Agent · ${pluginName} · ${parts.join('/')}`;
    logs.set(id, {
      id,
      origin: 'agent',
      pluginName: `Agent · ${pluginName}`,
      transformName: parts.join('/'),
      entityValue: '',
      status: data.status,
      message: data.summary,
      startTime: previous?.startTime ?? new Date(at - (data.durationMs ?? 0)),
      ...(data.status !== 'running' ? { endTime: new Date(at) } : {}),
      ...(data.status === 'failed' ? { error: data.summary } : {}),
      viewed: true
    });
    entries.push({
      id: `${id}:${event.sequence}`,
      at,
      level:
        data.status === 'running'
          ? 'info'
          : data.status === 'failed'
            ? 'error'
            : 'success',
      message: `${data.status === 'running' ? '▶' : data.status === 'failed' ? '✖' : '✔'} ${source}${data.durationMs !== undefined ? ` (${(data.durationMs / 1000).toFixed(1)} s)` : ''}${data.summary ? ` — ${data.summary}` : ''}`
    });
  }
  if (run.status !== 'running' && complete !== false)
    for (const log of Array.from(logs.values())) {
      if (log.status !== 'running') continue;
      log.status = 'failed';
      log.endTime = new Date(run.endedAt ?? run.createdAt);
      log.error = 'Run ended before transform completion was confirmed.';
      entries.push({
        id: `${log.id}:interrupted`,
        at: log.endTime.getTime(),
        level: 'warn',
        message: `■ ${log.pluginName} · ${log.transformName} — ${log.error}`
      });
    }
  return { logs: Array.from(logs.values()), entries };
}
