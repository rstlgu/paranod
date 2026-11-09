'use client';
import {
  BuildingsIcon as IconBuilding,
  SignOutIcon as IconLogout,
  GearIcon as IconSettings,
  UserCircleIcon as IconUserCircle
} from '@/components/icons';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { UserAvatarProfile } from '@/components/user-avatar-profile';
import { useAuthActions, useUser } from '@/lib/auth-client';
import { buildAppUrl } from '@/lib/url';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';

interface UserNavProps {
  size?: 'sm' | 'md';
  variant?: 'avatar' | 'sidebar-card';
}

export function UserNav({ size = 'sm', variant = 'avatar' }: UserNavProps) {
  const { user, isLoaded } = useUser();
  const { signOut } = useAuthActions();

  const router = useRouter();
  const signOutRedirectUrl = buildAppUrl('/sign-in');

  const avatarClassName = size === 'md' ? 'h-8 w-8' : 'h-6 w-6';
  const triggerIsCard = variant === 'sidebar-card';
  const userName = user?.fullName ? String(user.fullName) : 'Account';
  const userEmail = user?.emailAddresses?.[0]?.emailAddress
    ? String(user.emailAddresses[0].emailAddress)
    : '';

  if (!isLoaded) {
    return triggerIsCard ? (
      <Skeleton className='h-10 w-full rounded-md' />
    ) : (
      <Skeleton className={cn(avatarClassName, 'rounded-full')} />
    );
  }

  if (user) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant='ghost'
            className={cn(
              triggerIsCard
                ? 'bg-muted/30 hover:bg-muted/50 text-foreground h-10 w-full justify-start gap-2 rounded-md border px-2 py-1'
                : 'relative rounded-full p-0',
              triggerIsCard ? '' : avatarClassName
            )}
          >
            <UserAvatarProfile user={user} className={avatarClassName} />
            {triggerIsCard ? (
              <div className='min-w-0 flex-1 text-left'>
                <div className='truncate text-sm leading-tight font-medium'>
                  {userName}
                </div>
                {userEmail ? (
                  <div className='text-muted-foreground truncate text-[11px] leading-tight'>
                    {userEmail}
                  </div>
                ) : null}
              </div>
            ) : null}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className='w-56'
          align='end'
          sideOffset={8}
          forceMount
        >
          <DropdownMenuLabel className='font-normal'>
            <div className='flex flex-col space-y-1'>
              <p className='text-sm leading-none font-medium'>
                {user.fullName}
              </p>
              <p className='text-muted-foreground text-xs leading-none'>
                {user.emailAddresses[0].emailAddress}
              </p>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => router.push('/settings/account')}>
              <IconUserCircle className='mr-2 h-4 w-4' />
              Account
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => router.push('/settings/workspace')}
            >
              <IconBuilding className='mr-2 h-4 w-4' />
              Workspace
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => router.push('/settings/self-host')}
            >
              <IconSettings className='mr-2 h-4 w-4' />
              Settings
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              void signOut({ redirectUrl: signOutRedirectUrl });
            }}
          >
            <IconLogout className='mr-2 h-4 w-4' />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }
}
