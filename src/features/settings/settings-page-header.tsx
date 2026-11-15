import type { ReactNode } from 'react';

export function SettingsPageHeader({
  eyebrow,
  title,
  description,
  action
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className='flex flex-col gap-4 pb-1 sm:flex-row sm:items-start sm:justify-between'>
      <div className='max-w-2xl'>
        <p className='sr-only'>{eyebrow}</p>
        <h1 className='text-[19px] font-medium tracking-tight'>{title}</h1>
        <p className='text-muted-foreground mt-2 text-[13px] leading-6'>
          {description}
        </p>
      </div>
      {action ? <div className='shrink-0'>{action}</div> : null}
    </header>
  );
}
