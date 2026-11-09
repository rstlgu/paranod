'use client';

import * as React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { LogoOrIcon } from '@/features/graph/components/graph-editor/components/logo-or-icon';
import type { FlowTransformNodeData } from '@/features/flow/types';
import { getBuiltInPluginStyle } from '@/features/plugins/utils/plugin-style';

function isProbablyUrl(value: string | null | undefined) {
  if (!value) return false;
  return (
    value.startsWith('http://') ||
    value.startsWith('https://') ||
    value.startsWith('data:') ||
    value.startsWith('/api/logo')
  );
}

export interface OpenTransformNodeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nodeId: string;
  nodeData: FlowTransformNodeData;
}

export function OpenTransformNodeDialog(props: OpenTransformNodeDialogProps) {
  const pluginLabel = props.nodeData?.pluginName
    ? String(props.nodeData.pluginName)
    : String(props.nodeData?.pluginId ?? 'Plugin');

  const inputTypes = [String(props.nodeData?.inputType ?? 'custom')];
  const iconKey = isProbablyUrl(props.nodeData?.pluginIcon ?? null)
    ? undefined
    : (props.nodeData?.pluginIcon ?? undefined);

  const builtinStyle = getBuiltInPluginStyle(inputTypes, iconKey, undefined);
  const logoUrl =
    props.nodeData?.pluginLogoUrl ??
    (isProbablyUrl(props.nodeData?.pluginIcon ?? null) ? props.nodeData?.pluginIcon : undefined);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className='sm:max-w-xl'>
        <DialogHeader className='pb-2'>
          <div className='flex items-center gap-3'>
            <div className={cn('rounded-lg p-2.5', builtinStyle.headerBg)}>
              <LogoOrIcon
                label={pluginLabel}
                logoUrl={logoUrl ?? undefined}
                Icon={builtinStyle.Icon}
                sizePx={28}
                iconClassName={cn('h-7 w-7', builtinStyle.headerText)}
                className='h-7 w-7'
              />
            </div>
            <div className='min-w-0 flex-1'>
              <DialogTitle className='text-lg'>{props.nodeData?.name || 'Transform'}</DialogTitle>
              <DialogDescription className='text-xs'>
                {pluginLabel} · Node ID: {props.nodeId}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <Separator />

        <ScrollArea className='max-h-[420px] pr-4'>
          <div className='space-y-4 py-2'>
            {(props.nodeData?.inputType ||
              (Array.isArray(props.nodeData?.outputTypes) && props.nodeData.outputTypes.length > 0)) ? (
              <div className='flex flex-wrap gap-2'>
                {props.nodeData?.inputType ? (
                  <Badge variant='outline' className='border-border/40 bg-background/60'>
                    In: {props.nodeData.inputType}
                  </Badge>
                ) : null}
                {Array.isArray(props.nodeData?.outputTypes) && props.nodeData.outputTypes.length > 0 ? (
                  <Badge variant='outline' className='border-border/40 bg-background/60'>
                    Out: {props.nodeData.outputTypes.join(', ')}
                  </Badge>
                ) : null}
              </div>
            ) : null}

            <div>
              <p className='text-muted-foreground mb-1.5 text-xs font-medium tracking-wide uppercase'>
                Description
              </p>
              {props.nodeData?.description ? (
                <div className='bg-muted/50 rounded-lg border border-border/40 p-3 text-sm whitespace-pre-wrap'>
                  {props.nodeData.description}
                </div>
              ) : (
                <div className='text-muted-foreground text-sm italic'>No description.</div>
              )}
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
