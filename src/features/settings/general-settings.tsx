'use client';

import { Desktop, Moon, Sun } from '@phosphor-icons/react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  SettingsSection,
  SettingsRow,
  settingsStyles as ui
} from './settings-fields';

export function GeneralSettings() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <div>
      <SettingsSection title='Appearance'>
        <SettingsRow
          label='Theme'
          description='Use your device appearance, or choose a theme.'
        >
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
                    'bg-foreground/15 text-foreground shadow-sm'
                )}
              >
                <Icon size={20} />
              </button>
            ))}
          </div>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title='About Paranod'>
        <SettingsRow
          label='Open-source project'
          description='Source code, releases and contributions.'
        >
          <a
            href='https://github.com/rstlgu/paranod'
            target='_blank'
            rel='noopener noreferrer'
            className={ui.action}
          >
            GitHub
          </a>
        </SettingsRow>
        <SettingsRow
          label='License'
          description='License terms and source information.'
        >
          <a
            href='/source.html'
            target='_blank'
            rel='noopener noreferrer'
            className={ui.action}
          >
            View license
          </a>
        </SettingsRow>
      </SettingsSection>
    </div>
  );
}
