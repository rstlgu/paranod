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
    <header className='border-border/70 flex flex-col gap-5 border-b pb-7 sm:flex-row sm:items-end sm:justify-between'>
      <div className='max-w-2xl'>
        <p className='text-primary mb-2 text-[11px] font-semibold tracking-[0.18em] uppercase'>
          {eyebrow}
        </p>
        <h1 className='text-2xl font-semibold tracking-tight sm:text-[1.75rem]'>
          {title}
        </h1>
        <p className='text-muted-foreground mt-2 text-sm leading-6'>
          {description}
        </p>
      </div>
      {action ? <div className='shrink-0'>{action}</div> : null}
    </header>
  );
}
