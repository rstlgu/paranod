'use client';

import { useState } from 'react';
import { IconEye, IconEyeOff } from '@tabler/icons-react';

import type { ConfigField } from '@/features/plugins/types';
import { SECRET_PLACEHOLDER } from '@/features/plugins/config-constants';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  SettingsRow,
  settingsStyles as ui
} from '@/features/settings/settings-fields';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';

interface PluginConfigSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pluginId: string;
  title: string;
  description?: string;
  configSchema: Record<string, ConfigField>;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  onSave: () => void;
  isSaving?: boolean;
  isMissingRequiredConfig?: boolean;
  saveLabel?: string;
}

export function PluginConfigSheet({
  open,
  onOpenChange,
  title,
  description = 'Enter the credentials and settings required by this plugin.',
  configSchema,
  value,
  onChange,
  onSave,
  isSaving = false,
  isMissingRequiredConfig = false,
  saveLabel = 'Save'
}: PluginConfigSheetProps) {
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});

  function updateField(key: string, nextValue: unknown) {
    onChange({ ...value, [key]: nextValue });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) setShowSecrets({});
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        className='settings-subdialog flex max-h-[calc(100dvh-64px)] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[680px]'
        style={{ fontFamily: 'var(--font-geist), system-ui, sans-serif' }}
      >
        <DialogHeader className='shrink-0 border-b px-5 pt-5 pr-12 pb-4'>
          <DialogTitle className='flex items-center gap-2 text-base'>
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className='min-h-0 flex-1 overflow-y-auto px-4 py-4'>
          <div className='flex flex-col gap-4'>
            {isMissingRequiredConfig ? (
              <p className='text-destructive text-xs'>
                Missing required fields.
              </p>
            ) : null}

            {Object.entries(configSchema).map(([key, field]) => {
              return (
                <SettingsRow
                  key={key}
                  htmlFor={key}
                  label={`${field.label}${field.required ? ' *' : ''}`}
                  description={field.description}
                >
                  {field.type === 'select' && field.options ? (
                    <Select
                      value={
                        (value[key] as string) ||
                        (field.default as string) ||
                        ''
                      }
                      onValueChange={(nextValue) => updateField(key, nextValue)}
                    >
                      <SelectTrigger id={key} className='w-full'>
                        <SelectValue placeholder={`Select ${field.label}`} />
                      </SelectTrigger>
                      <SelectContent className='w-[var(--radix-select-trigger-width)]'>
                        {field.options.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : field.type === 'boolean' ? (
                    <Switch
                      id={key}
                      checked={Boolean(value[key] ?? field.default)}
                      onCheckedChange={(checked) => updateField(key, checked)}
                    />
                  ) : field.type === 'number' ? (
                    <Input
                      id={key}
                      type='number'
                      placeholder={
                        field.default != null
                          ? String(field.default)
                          : `Enter ${field.label}`
                      }
                      value={
                        value[key] === undefined || value[key] === null
                          ? ''
                          : String(value[key])
                      }
                      onChange={(event) =>
                        updateField(
                          key,
                          event.target.value === ''
                            ? ''
                            : Number(event.target.value)
                        )
                      }
                    />
                  ) : (
                    <div className='relative min-w-0'>
                      <Input
                        id={key}
                        type={
                          field.secret && !showSecrets[key]
                            ? 'password'
                            : 'text'
                        }
                        placeholder={
                          field.secret
                            ? '••••••••••••••••'
                            : `Enter ${field.label}`
                        }
                        value={(value[key] as string) || ''}
                        onChange={(event) =>
                          updateField(key, event.target.value)
                        }
                      />

                      {field.secret ? (
                        <Button
                          type='button'
                          aria-label={
                            showSecrets[key]
                              ? `Hide ${field.label}`
                              : `Show ${field.label}`
                          }
                          variant='ghost'
                          size='icon'
                          className='absolute top-1/2 right-1 h-7 w-7 -translate-y-1/2'
                          onClick={() =>
                            setShowSecrets((prev) => ({
                              ...prev,
                              [key]: !prev[key]
                            }))
                          }
                        >
                          {showSecrets[key] ? (
                            <IconEyeOff className='h-4 w-4' />
                          ) : (
                            <IconEye className='h-4 w-4' />
                          )}
                        </Button>
                      ) : null}

                      {field.secret && value[key] === SECRET_PLACEHOLDER ? (
                        <p className='text-muted-foreground mt-1 text-[11px]'>
                          Saved and encrypted. Type a new value to replace it,
                          or clear the field to remove it.
                        </p>
                      ) : null}
                    </div>
                  )}
                </SettingsRow>
              );
            })}
          </div>
        </div>

        <DialogFooter className='shrink-0 flex-row justify-end border-t px-5 py-4'>
          <Button
            variant='outline'
            onClick={() => onOpenChange(false)}
            className={ui.action}
          >
            Cancel
          </Button>
          <Button onClick={onSave} disabled={isSaving} className={ui.action}>
            {saveLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
