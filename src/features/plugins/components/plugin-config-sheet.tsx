'use client';

import { useState } from 'react';
import {
  IconCheck,
  IconEye,
  IconEyeOff,
  IconLock,
  IconSettings
} from '@tabler/icons-react';

import type { ConfigField } from '@/features/plugins/types';
import { SECRET_PLACEHOLDER } from '@/features/plugins/config-constants';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet';
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
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) setShowSecrets({});
        onOpenChange(nextOpen);
      }}
    >
      <SheetContent
        side='right'
        className='flex h-full w-[420px] flex-col gap-0 p-0 sm:w-[520px] sm:max-w-none'
      >
        <SheetHeader className='shrink-0 border-b px-4 pt-4 pb-3'>
          <SheetTitle className='flex items-center gap-2 text-base'>
            <IconSettings className='h-5 w-5' />
            {title}
          </SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>

        <div className='min-h-0 flex-1 overflow-y-auto px-4 py-4'>
          <div className='flex flex-col gap-4'>
            {isMissingRequiredConfig ? (
              <p className='text-destructive text-xs'>Missing required fields.</p>
            ) : null}

            {Object.entries(configSchema).map(([key, field]) => {
              return (
                <div key={key} className='flex flex-col gap-2'>
                  <Label htmlFor={key} className='flex items-center gap-2'>
                    {field.label}
                    {field.required ? (
                      <span className='text-destructive'>*</span>
                    ) : null}
                    {field.secret ? (
                      <IconLock className='text-muted-foreground h-3 w-3' />
                    ) : null}
                  </Label>

                  {field.description ? (
                    <p className='text-muted-foreground text-xs'>
                      {field.description}
                    </p>
                  ) : null}

                  {field.type === 'select' && field.options ? (
                    <Select
                      value={
                        (value[key] as string) ||
                        (field.default as string) ||
                        ''
                      }
                      onValueChange={(nextValue) => updateField(key, nextValue)}
                    >
                      <SelectTrigger className='w-full'>
                        <SelectValue
                          placeholder={`Select ${field.label}`}
                        />
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
                    <div className='relative'>
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
                        onChange={(event) => updateField(key, event.target.value)}
                      />

                      {field.secret ? (
                        <Button
                          type='button'
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
                          Saved and encrypted. Type a new value to replace it, or
                          clear the field to remove it.
                        </p>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <SheetFooter className='bg-background shrink-0 flex-row border-t px-4 py-3'>
          <Button
            variant='outline'
            onClick={() => onOpenChange(false)}
            className='flex-1'
          >
            Cancel
          </Button>
          <Button onClick={onSave} disabled={isSaving} className='flex-1'>
            <IconCheck className='mr-2 h-4 w-4' />
            {saveLabel}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
