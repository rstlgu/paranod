'use client';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  CornersOutIcon as IconFitView,
  MagnifyingGlassIcon as IconSearch,
  PlusCircleIcon as IconCirclePlus,
  UploadSimpleIcon as IconUpload,
  DownloadSimpleIcon as IconDownload,
  ArrowsClockwiseIcon as IconRefresh,
  CopyIcon as IconCopy,
  FloppyDiskIcon as IconSave,
  CircleNotchIcon as IconLoader2,
  PlayIcon as IconPlay,
  ClockCounterClockwiseIcon as IconHistory,
  TextAlignLeftIcon as IconDescription
} from '@/components/icons';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { Focus, Redo2, Undo2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';

interface FlowTopbarProps {
  onManualSave: () => void;
  isSaving?: boolean;
  lastSavedAt?: Date | null;
  className?: string;

  // sidebar (match GraphTopbar behavior)
  openSidebarNodes?: () => void;
  openSidebarAdd?: () => void;

  // left side
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;

  // view controls
  onFitView?: () => void;
  onFitViewToSelected?: () => void;
  canFitViewToSelected?: boolean;

  // IO
  onExportJson?: () => void;
  onImportJson?: () => void;

  // lifecycle
  onDuplicate?: () => void;
  onRefresh?: () => void;

  // test run
  onTest?: () => void;
  onShowRuns?: () => void;

  // details
  onEditDescription?: () => void;
}

export function FlowTopbar({
  onManualSave,
  isSaving,
  lastSavedAt,
  className,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onFitView,
  onFitViewToSelected,
  canFitViewToSelected,
  onExportJson,
  onImportJson,
  onDuplicate,
  onRefresh,
  openSidebarNodes,
  openSidebarAdd,
  onTest,
  onShowRuns,
  onEditDescription
}: FlowTopbarProps) {
  function IconButton(args: {
    label: string;
    disabled?: boolean;
    compactIcon?: boolean;
    onClick?: () => void;
    children: React.ReactNode;
  }) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type='button'
            variant='ghost'
            size='icon'
            className={cn(
              'size-8',
              args.compactIcon
                ? '[&_svg]:!size-3.5'
                : "[&_svg:not([class*='size-'])]:!size-5"
            )}
            onClick={args.onClick}
            disabled={args.disabled}
            aria-label={args.label}
            title={args.label}
          >
            {args.children}
          </Button>
        </TooltipTrigger>
        <TooltipContent side='bottom' sideOffset={8}>
          {args.label}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div
      className={cn(
        'border-border/40 bg-background/90 supports-[backdrop-filter]:bg-background/70 relative flex h-11 w-full items-center gap-1 border-b px-1.5 shadow-sm backdrop-blur select-none dark:border-white/10',
        className
      )}
    >
      {/* Left actions */}
      <div className='flex items-center gap-0.5'>
        <IconButton
          label='Undo'
          onClick={onUndo}
          disabled={!canUndo}
          compactIcon
        >
          <Undo2 />
        </IconButton>
        <IconButton
          label='Redo'
          onClick={onRedo}
          disabled={!canRedo}
          compactIcon
        >
          <Redo2 />
        </IconButton>
      </div>

      <div className='bg-border/30 mx-1 h-6 w-px dark:bg-white/10' />

      <div className='flex items-center gap-0.5'>
        <IconButton
          label='Nodes panel'
          onClick={openSidebarNodes}
          disabled={!openSidebarNodes}
        >
          <IconSearch className='h-4 w-4' />
        </IconButton>
        <IconButton
          label='Add transforms'
          onClick={openSidebarAdd}
          disabled={!openSidebarAdd}
        >
          <IconCirclePlus className='h-4 w-4' />
        </IconButton>
      </div>

      <div className='bg-border/30 mx-1 h-6 w-px dark:bg-white/10' />

      <div className='flex items-center gap-0.5'>
        <IconButton label='Fit view' onClick={onFitView}>
          <IconFitView className='h-4 w-4' />
        </IconButton>
        <IconButton
          label='Fit view to selected'
          onClick={onFitViewToSelected}
          disabled={!canFitViewToSelected}
        >
          <Focus className='size-5' strokeWidth={1.75} />
        </IconButton>
      </div>

      <div className='flex-1' />

      {/* Right actions */}
      {onTest ? (
        <>
          <Button
            type='button'
            variant='outline'
            size='sm'
            className='h-8 gap-1.5 px-3 text-xs'
            onClick={onTest}
            aria-label='Test flow'
            title='Test flow with a sample input'
          >
            <IconPlay className='h-3.5 w-3.5' />
            Test
          </Button>
          <div className='bg-border/30 mx-1 h-6 w-px dark:bg-white/10' />
        </>
      ) : null}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <span>
            <Button
              type='button'
              variant='ghost'
              size='icon'
              className="size-8 [&_svg:not([class*='size-'])]:!size-5"
              aria-label='Import / Export'
              title='Import / Export'
            >
              <IconUpload className='h-4 w-4' />
            </Button>
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='min-w-[200px]'>
          <DropdownMenuItem className='gap-2' onClick={onImportJson}>
            <IconUpload className='h-4 w-4' />
            <span>Import JSON</span>
          </DropdownMenuItem>
          <DropdownMenuItem className='gap-2' onClick={onExportJson}>
            <IconDownload className='h-4 w-4' />
            <span>Export JSON</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {onEditDescription ? (
            <DropdownMenuItem className='gap-2' onClick={onEditDescription}>
              <IconDescription className='h-4 w-4' />
              <span>Edit description</span>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem className='gap-2' onClick={onDuplicate}>
            <IconCopy className='h-4 w-4' />
            <span>Duplicate</span>
          </DropdownMenuItem>
          {onShowRuns ? (
            <DropdownMenuItem className='gap-2' onClick={onShowRuns}>
              <IconHistory className='h-4 w-4' />
              <span>Run history</span>
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <div className='bg-border/30 mx-1 h-6 w-px dark:bg-white/10' />

      <div className='flex items-center gap-0.5'>
        <IconButton label='Refresh' onClick={onRefresh} disabled={!onRefresh}>
          <IconRefresh className='h-4 w-4' />
        </IconButton>
      </div>

      <div className='bg-border/30 mx-1 h-6 w-px dark:bg-white/10' />

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant='ghost'
            size='icon'
            className="size-8 [&_svg:not([class*='size-'])]:!size-5"
            onClick={onManualSave}
            disabled={!!isSaving}
            aria-label='Save'
            title='Save'
          >
            {isSaving ? (
              <IconLoader2 className='h-4 w-4 animate-spin' />
            ) : (
              <IconSave className='h-4 w-4' />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side='bottom' sideOffset={8}>
          {isSaving
            ? 'Saving…'
            : lastSavedAt
              ? `Saved at ${lastSavedAt.toLocaleTimeString()}`
              : 'Save'}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
