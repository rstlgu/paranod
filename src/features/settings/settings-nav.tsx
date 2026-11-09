'use client';

/** Responsive settings header. Items come from the settings layout. */

import { Skeleton } from '@/components/ui/skeleton';
import { UserAvatarProfile } from '@/components/user-avatar-profile';
import { useUser } from '@/lib/auth-client';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import {
  BuildingsIcon,
  HardDrivesIcon,
  RobotIcon,
  UserCircleIcon
} from '@/components/icons';

export interface SettingsNavItem {
  href: string;
  label: string;
  shortLabel: string;
  icon: 'account' | 'workspaces' | 'agent' | 'self-host';
}

const ICONS = {
  account: UserCircleIcon,
  workspaces: BuildingsIcon,
  agent: RobotIcon,
  'self-host': HardDrivesIcon
} as const;

export function SettingsNav({ items }: { items: SettingsNavItem[] }) {
  const pathname = usePathname();
  const { user, isLoaded } = useUser();

  return (
    <header className='bg-background/90 border-border/70 sticky top-0 z-20 border-b backdrop-blur-xl'>
      <div className='mx-auto w-full max-w-6xl px-4 pt-4 sm:px-6 sm:pt-5 lg:px-8'>
        <div className='flex items-center justify-between gap-4'>
          <div>
            <p className='text-muted-foreground text-[10px] font-semibold tracking-[0.2em] uppercase'>
              Control center
            </p>
            <h1 className='mt-0.5 text-lg font-semibold tracking-tight'>
              Settings
            </h1>
          </div>

          <div className='hidden min-w-0 items-center gap-2.5 sm:flex'>
            {isLoaded && user ? (
              <>
                <div className='min-w-0 text-right'>
                  <p className='max-w-56 truncate text-xs font-medium'>
                    {user.primaryEmailAddress?.emailAddress ?? user.fullName}
                  </p>
                  <p className='text-muted-foreground text-[11px]'>
                    {'Self-hosted installation'}
                  </p>
                </div>
                <UserAvatarProfile user={user} className='size-8' />
              </>
            ) : (
              <>
                <div className='space-y-1'>
                  <Skeleton className='h-3 w-28' />
                  <Skeleton className='ml-auto h-2.5 w-16' />
                </div>
                <Skeleton className='size-8 rounded-full' />
              </>
            )}
          </div>
        </div>

        <nav
          aria-label='Settings sections'
          className='mt-4 flex [scrollbar-width:none] gap-1 overflow-x-auto pb-2 [&::-webkit-scrollbar]:hidden'
        >
          {items.map((item) => {
            const Icon = ICONS[item.icon];
            const isActive =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'group relative flex h-10 shrink-0 items-center gap-2 rounded-lg px-3 text-sm transition-colors',
                  isActive
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                )}
              >
                <Icon
                  className='size-4 shrink-0'
                  weight={isActive ? 'fill' : 'regular'}
                />
                <span className='sm:hidden'>{item.shortLabel}</span>
                <span className='hidden sm:inline'>{item.label}</span>
                <span
                  className={cn(
                    'bg-primary absolute right-3 bottom-0 left-3 h-0.5 origin-center rounded-full transition-transform',
                    isActive ? 'scale-x-100' : 'scale-x-0'
                  )}
                />
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
