'use client';

import {
  CaretRightIcon as IconChevronRight,
  LightningIcon as IconTransform
} from '@/components/icons';
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState, type ElementType, type ReactNode } from 'react';

import { LogoOrIcon } from '@/features/graph/components/graph-editor/components/logo-or-icon';
import { getEntityConfig } from '@/features/graph/config/entity-config';
import { matchesInputType, type EntityType } from '@/features/plugins';
import { getBuiltInPluginStyle } from '@/features/plugins/utils/plugin-style';
import { cn } from '@/lib/utils';
import type {
  FlowTransformPickerGroup,
  FlowTransformPickerItem
} from '../flow-connection-filter-context';

interface FlowTransformPickerProps {
  trigger: ReactNode;
  triggerNodeType: string;
  groups: FlowTransformPickerGroup[];
  onSelect: (transform: FlowTransformPickerItem) => void;
}

function isProbablyUrl(value: string | null | undefined) {
  if (!value) return false;
  return (
    value.startsWith('http://') ||
    value.startsWith('https://') ||
    value.startsWith('data:') ||
    value.startsWith('/api/logo')
  );
}

export function FlowTransformPicker(props: FlowTransformPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [openPluginId, setOpenPluginId] = useState<string | null>(null);

  const compatibleGroups = useMemo(
    () =>
      props.groups
        .map((group) => ({
          ...group,
          transforms: group.transforms.filter((transform) => {
            const inputType = String(transform.inputType ?? '').trim();
            if (!inputType) return false;
            return matchesInputType(
              props.triggerNodeType as EntityType,
              inputType
            );
          })
        }))
        .filter((group) => group.transforms.length > 0),
    [props.groups, props.triggerNodeType]
  );

  const compatibleTransformCount = useMemo(
    () =>
      compatibleGroups.reduce(
        (total, group) => total + group.transforms.length,
        0
      ),
    [compatibleGroups]
  );
  const openGroup = compatibleGroups.find(
    (group) => group.pluginId === openPluginId
  );
  const estimatedListHeight =
    compatibleGroups.length * 48 + (openGroup?.transforms.length ?? 0) * 64;
  const shouldScroll = estimatedListHeight > 340;
  const ContentContainer = shouldScroll ? ScrollArea : 'div';

  return (
    <Popover
      open={isOpen}
      onOpenChange={(open) => {
        setIsOpen(open);
        if (!open) setOpenPluginId(null);
      }}
    >
      <PopoverTrigger asChild>{props.trigger}</PopoverTrigger>
      <PopoverContent
        className='bg-popover w-72 rounded-xl border p-2 shadow-md'
        align='center'
        side='right'
        sideOffset={8}
        avoidCollisions
        collisionPadding={12}
        sticky='always'
      >
        <div className='border-border/50 flex items-center gap-1.5 border-b px-2 pt-1 pb-2 text-xs font-semibold'>
          <IconTransform className='h-3 w-3' weight='fill' />
          <span>
            Available Transforms
            {compatibleTransformCount > 0
              ? ` (${compatibleTransformCount})`
              : ''}
          </span>
        </div>

        {compatibleGroups.length === 0 ? (
          <p className='text-muted-foreground px-2 py-4 text-center text-sm'>
            No transforms available for this trigger type.
          </p>
        ) : (
          <ContentContainer className={cn('mt-1', shouldScroll && 'h-[340px]')}>
            <div className={cn('space-y-1', shouldScroll && 'pr-3')}>
              {compatibleGroups.map((group, groupIndex) => {
                const firstTransform = group.transforms[0];
                const pluginIcon = firstTransform?.pluginIcon ?? null;
                const pluginLogoUrl =
                  firstTransform?.pluginLogoUrl ??
                  (isProbablyUrl(pluginIcon) ? pluginIcon : undefined);
                const pluginStyle = getBuiltInPluginStyle(
                  [props.triggerNodeType],
                  isProbablyUrl(pluginIcon)
                    ? undefined
                    : (pluginIcon ?? undefined),
                  pluginLogoUrl ?? undefined
                );
                const isGroupOpen = openPluginId === group.pluginId;

                return (
                  <motion.div
                    key={group.pluginId}
                    className='relative'
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: 0.15,
                      delay: groupIndex * 0.04,
                      ease: 'easeOut'
                    }}
                  >
                    <button
                      type='button'
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-all',
                        isGroupOpen ? 'bg-muted' : 'hover:bg-muted'
                      )}
                      onClick={() =>
                        setOpenPluginId(isGroupOpen ? null : group.pluginId)
                      }
                    >
                      <LogoOrIcon
                        label={group.pluginName}
                        logoUrl={pluginLogoUrl ?? undefined}
                        Icon={pluginStyle.Icon}
                        sizePx={24}
                        className='h-6 w-6'
                        iconClassName='text-primary h-4 w-4'
                      />
                      <div className='min-w-0 flex-1'>
                        <p className='truncate font-medium'>
                          {group.pluginName}
                        </p>
                        <p className='text-muted-foreground text-xs'>
                          {group.transforms.length}{' '}
                          {group.transforms.length === 1
                            ? 'transform'
                            : 'transforms'}
                        </p>
                      </div>
                      <motion.div
                        animate={{ rotate: isGroupOpen ? 90 : 0 }}
                        transition={{ duration: 0.2, ease: 'easeInOut' }}
                      >
                        <IconChevronRight className='text-muted-foreground h-4 w-4' />
                      </motion.div>
                    </button>

                    <AnimatePresence>
                      {isGroupOpen ? (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.2, ease: 'easeInOut' }}
                          className='overflow-hidden'
                        >
                          <div className='border-muted mt-1 ml-4 space-y-1 border-l-2 pl-2'>
                            {group.transforms.map((transform, index) => {
                              const outputType = String(
                                transform.outputTypes?.[0] ?? 'custom'
                              );
                              const outputConfig = getEntityConfig(outputType);
                              const OutputIcon =
                                outputConfig.icon as ElementType;

                              return (
                                <motion.button
                                  key={`${transform.pluginId}-${transform.transformId}`}
                                  type='button'
                                  initial={{ opacity: 0, x: -10 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  transition={{
                                    duration: 0.15,
                                    delay: index * 0.04,
                                    ease: 'easeOut'
                                  }}
                                  className='hover:bg-muted flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors'
                                  onClick={() => {
                                    props.onSelect(transform);
                                    setIsOpen(false);
                                  }}
                                >
                                  <span
                                    className={cn(
                                      'rounded p-1',
                                      outputConfig.headerBg
                                    )}
                                  >
                                    <OutputIcon
                                      className={cn(
                                        'h-3 w-3',
                                        outputConfig.headerText
                                      )}
                                    />
                                  </span>
                                  <div className='min-w-0 flex-1'>
                                    <div className='flex items-center gap-1.5'>
                                      <p className='truncate font-medium'>
                                        {transform.name}
                                      </p>
                                    </div>
                                    {transform.description ? (
                                      <p className='text-muted-foreground line-clamp-2 text-xs'>
                                        {transform.description}
                                      </p>
                                    ) : null}
                                  </div>
                                </motion.button>
                              );
                            })}
                          </div>
                        </motion.div>
                      ) : null}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </div>
          </ContentContainer>
        )}
      </PopoverContent>
    </Popover>
  );
}
