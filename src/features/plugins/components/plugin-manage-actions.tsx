'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  IconSettings,
  IconTrash
} from '@tabler/icons-react';
import { toast } from 'sonner';

import type { ConfigField } from '@/features/plugins/types';
import { PluginConfigSheet } from '@/features/plugins/components/plugin-config-sheet';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';

export interface PluginManageActionsProps {
  pluginId: string;
  pluginName: string;
  initialEnabled: boolean;
  canEdit: boolean;
  requiresConfig?: boolean;
  configSchema?: Record<string, ConfigField>;
  initialConfig?: Record<string, unknown>;
  isExternal?: boolean;
  onUpdated?: () => void;
}

export function PluginManageActions(props: PluginManageActionsProps) {
  const router = useRouter();
  const {
    pluginId,
    pluginName,
    initialEnabled,
    canEdit,
    requiresConfig,
    configSchema,
    initialConfig,
    isExternal = false,
    onUpdated
  } = props;

  const [enabled, setEnabled] = useState(initialEnabled);
  const [isToggling, setIsToggling] = useState(false);
  const [isUninstalling, setIsUninstalling] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [tempConfig, setTempConfig] = useState<Record<string, unknown>>(
    initialConfig || {}
  );

  const hasConfig = !!requiresConfig && !!configSchema;

  const isMissingRequiredConfig = useMemo(() => {
    if (!hasConfig) return false;
    for (const [key, field] of Object.entries(configSchema)) {
      if (field.required && !tempConfig[key]) return true;
    }
    return false;
  }, [configSchema, hasConfig, tempConfig]);

  async function togglePlugin(nextEnabled: boolean) {
    if (!canEdit) {
      toast.error('Only workspace admins can change plugin settings');
      return;
    }

    setIsToggling(true);
    try {
      const toggleUrl = isExternal
        ? `/api/addons/${pluginId}/toggle`
        : `/api/plugins/${pluginId}/toggle`;
      const response = await fetch(toggleUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: nextEnabled })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Toggle failed');
      }

      setEnabled(nextEnabled);
      onUpdated?.();
      router.refresh();
      toast.success(nextEnabled ? 'Plugin enabled' : 'Plugin disabled');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Toggle failed');
    } finally {
      setIsToggling(false);
    }
  }

  function openConfig() {
    if (!canEdit) {
      toast.error('Only workspace admins can change plugin settings');
      return;
    }
    setTempConfig(initialConfig || {});
    setConfigDialogOpen(true);
  }

  async function saveConfig() {
    if (!canEdit) {
      toast.error('Only workspace admins can change plugin settings');
      return;
    }
    if (!hasConfig) return;

    setIsSavingConfig(true);
    try {
      const response = await fetch(`/api/plugins/${pluginId}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: tempConfig })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save configuration');
      }

      onUpdated?.();
      router.refresh();
      setConfigDialogOpen(false);
      toast.success(`Configuration saved for ${pluginName}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to save configuration'
      );
    } finally {
      setIsSavingConfig(false);
    }
  }

  async function uninstallPlugin() {
    if (!canEdit) {
      toast.error('Only administrators can uninstall plugins');
      return;
    }

    if (
      !confirm(
        `Are you sure you want to uninstall ${pluginName}? This action will remove the plugin and all associated transforms.`
      )
    ) {
      return;
    }

    setIsUninstalling(true);
    try {
      const response = await fetch(`/api/addons/${pluginId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Unable to uninstall the addon');
      }

      onUpdated?.();
      toast.success(`${pluginName} uninstalled successfully`);

      // Redirect to plugins page after uninstall
      router.push('/plugins');
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Unable to uninstall the plugin'
      );
    } finally {
      setIsUninstalling(false);
    }
  }

  return (
    <>
      <div className='flex flex-col items-end gap-2'>
        <div className='flex items-center gap-2'>
          {hasConfig && (
            <Button
              variant='outline'
              size='sm'
              onClick={openConfig}
              disabled={!canEdit}
              className='gap-2'
            >
              <IconSettings className='h-4 w-4' />
              Settings
            </Button>
          )}
          {isExternal && (
            <Button
              variant='outline'
              size='sm'
              onClick={uninstallPlugin}
              disabled={!canEdit || isUninstalling}
              className='gap-2 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-900/30 dark:text-red-400 dark:hover:bg-red-900/10'
            >
              <IconTrash className='h-4 w-4' />
              Uninstall
            </Button>
          )}
          <div className='flex items-center gap-2'>
            <Switch
              checked={enabled}
              onCheckedChange={togglePlugin}
              disabled={!canEdit || isToggling}
              className='scale-125'
            />
          </div>
        </div>
      </div>

      {hasConfig && (
        <PluginConfigSheet
          open={configDialogOpen}
          onOpenChange={setConfigDialogOpen}
          pluginId={pluginId}
          title={`Settings: ${pluginName}`}
          configSchema={configSchema}
          value={tempConfig}
          onChange={setTempConfig}
          onSave={saveConfig}
          isSaving={isSavingConfig}
          isMissingRequiredConfig={isMissingRequiredConfig}
          saveLabel='Save'
        />
      )}
    </>
  );
}
