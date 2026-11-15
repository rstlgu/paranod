'use client';

import { Desktop, Moon, Sun, ArrowSquareOut } from '@phosphor-icons/react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { SettingsPageHeader } from './settings-page-header';

export function GeneralSettings() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <div className='space-y-8'>
      <SettingsPageHeader
        eyebrow='Preferences'
        title='General'
        description='Make Paranod feel at home in your workspace.'
      />
      <section aria-labelledby='appearance-heading'>
        <h2 id='appearance-heading' className='mb-4 text-[15px] font-medium'>
          Appearance
        </h2>
        <div className='flex items-center justify-between gap-6 border-b py-5'>
          <div>
            <p className='text-sm'>Theme</p>
            <p className='text-muted-foreground mt-1 text-xs'>
              Choose a look, or follow your device.
            </p>
          </div>
          <div
            role='group'
            aria-label='Theme'
            className='bg-muted/70 flex shrink-0 gap-1 rounded-lg p-1'
          >
            {[
              { value: 'system', label: 'System', icon: Desktop },
              { value: 'light', label: 'Light', icon: Sun },
              { value: 'dark', label: 'Dark', icon: Moon }
            ].map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type='button'
                title={label}
                aria-label={`${label} theme`}
                aria-pressed={mounted && theme === value}
                onClick={() => setTheme(value)}
                className={cn(
                  'text-muted-foreground hover:text-foreground flex size-8 items-center justify-center rounded-md transition-colors',
                  mounted &&
                    theme === value &&
                    'bg-background text-foreground shadow-sm'
                )}
              >
                <Icon size={20} />
              </button>
            ))}
          </div>
        </div>
      </section>
      <section aria-labelledby='about-heading'>
        <h2 id='about-heading' className='mb-4 text-[15px] font-medium'>
          About Paranod
        </h2>
        <p className='text-muted-foreground max-w-lg text-sm leading-6'>
          A shared workspace for OSINT tools, connected information and
          AI-assisted investigation.
        </p>
        <a
          href='https://github.com/rstlgu/paranod'
          target='_blank'
          rel='noopener noreferrer'
          className='hover:text-primary mt-5 flex items-center justify-between gap-4 border-b py-4 text-sm'
        >
          Open-source project
          <ArrowSquareOut size={17} />
        </a>
        <a
          href='/source.html'
          target='_blank'
          rel='noopener noreferrer'
          className='hover:text-primary flex items-center justify-between gap-4 border-b py-4 text-sm'
        >
          License & source
          <ArrowSquareOut size={17} />
        </a>
      </section>
    </div>
  );
}
