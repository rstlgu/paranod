import type { ActionId, ActionImpl } from 'kbar';
import * as React from 'react';

const ResultItem = React.forwardRef(
  (
    {
      action,
      active,
      currentRootActionId
    }: {
      action: ActionImpl;
      active: boolean;
      currentRootActionId: ActionId;
    },
    ref: React.Ref<HTMLDivElement>
  ) => {
    const ancestors = React.useMemo(() => {
      if (!currentRootActionId) return action.ancestors;
      const index = action.ancestors.findIndex(
        (ancestor) => ancestor.id === currentRootActionId
      );
      return action.ancestors.slice(index + 1);
    }, [action.ancestors, currentRootActionId]);

    return (
      <div
        ref={ref}
        className={`relative z-10 flex cursor-pointer items-center justify-between rounded-lg px-4 py-2.5 transition-colors ${
          active
            ? 'bg-zinc-100 dark:bg-zinc-800/50'
            : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/30'
        }`}
      >
        <div className='flex items-center gap-3'>
          {action.icon && (
            <div className='flex h-8 w-8 shrink-0 items-center justify-center'>
              {action.icon}
            </div>
          )}
          <div className='flex min-w-0 flex-1 flex-col'>
            <div className='flex items-center gap-2'>
              {ancestors.length > 0 &&
                ancestors.map((ancestor) => (
                  <React.Fragment key={ancestor.id}>
                    <span className='text-muted-foreground text-xs'>
                      {ancestor.name}
                    </span>
                    <span className='text-muted-foreground text-xs'>/</span>
                  </React.Fragment>
                ))}
              <span className='font-medium'>{action.name}</span>
            </div>
            {action.subtitle && (
              <span className='text-muted-foreground text-xs'>
                {action.subtitle}
              </span>
            )}
          </div>
        </div>
        {action.shortcut?.length ? (
          <div className='flex shrink-0 gap-1'>
            {action.shortcut.map((sc, i) => (
              <kbd
                key={sc + i}
                className='flex h-6 min-w-6 items-center justify-center rounded-md border border-zinc-200 bg-zinc-100 px-1.5 text-[10px] font-semibold text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
              >
                {sc}
              </kbd>
            ))}
          </div>
        ) : null}
      </div>
    );
  }
);

ResultItem.displayName = 'KBarResultItem';

export default ResultItem;
