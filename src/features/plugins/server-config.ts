/** Server-only plugin configuration: decrypt workspace secrets for execution. */
import { db } from '@/lib/db';
import {
  getBuiltinConfigSchema,
  resolveConfigForExecution
} from './config-service';

export async function loadWorkspacePluginConfig(
  workspaceId: string | null | undefined,
  pluginId: string
): Promise<Record<string, unknown>> {
  if (!workspaceId) return {};
  const setting = await db.workspacePluginSetting.findUnique({
    where: { workspaceId_pluginId: { workspaceId, pluginId } },
    select: { config: true, enabled: true }
  });
  if (setting?.enabled === false) throw new Error('Plugin is disabled');
  if (!setting?.enabled || !setting.config) return {};
  return resolveConfigForExecution(
    setting.config,
    getBuiltinConfigSchema(pluginId)
  );
}
