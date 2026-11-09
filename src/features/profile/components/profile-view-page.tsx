'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  CheckCircleIcon,
  KeyIcon,
  ShieldCheckIcon,
  UserCircleIcon
} from '@phosphor-icons/react';
import { authClient, useUser } from '@/lib/auth-client';
import PageContainer from '@/components/layout/page-container';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Icons } from '@/components/icons';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription
} from '@/components/ui/card';
import { UserAvatarProfile } from '@/components/user-avatar-profile';
import { SettingsPageHeader } from '@/features/settings/settings-page-header';

function AccountContent({
  showSessionManagement
}: {
  showSessionManagement: boolean;
}) {
  const { user, isLoaded } = useUser();
  const [name, setName] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [revokingSessions, setRevokingSessions] = useState(false);

  useEffect(() => {
    if (user?.fullName) setName(user.fullName);
  }, [user?.fullName]);

  if (!isLoaded) {
    return (
      <div className='text-muted-foreground py-10 text-sm'>
        Loading account...
      </div>
    );
  }

  if (!user) return null;

  const updateProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    if (name.trim().length < 2) {
      toast.error('Name must contain at least 2 characters.');
      return;
    }

    setSavingProfile(true);
    const result = await authClient.updateUser({ name: name.trim() });
    setSavingProfile(false);

    if (result.error) {
      toast.error(result.error.message || 'Unable to update the profile.');
      return;
    }
    toast.success('Profile updated');
  };

  const updatePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (newPassword.length < 10) {
      toast.error('Use at least 10 characters for the new password.');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match.');
      return;
    }

    setSavingPassword(true);
    const result = await authClient.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: true
    });
    setSavingPassword(false);

    if (result.error) {
      toast.error(result.error.message || 'Unable to change the password.');
      return;
    }

    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    toast.success('Password updated and other sessions revoked');
  };

  const revokeOtherSessions = async () => {
    setRevokingSessions(true);
    const result = await authClient.revokeOtherSessions();
    setRevokingSessions(false);

    if (result.error) {
      toast.error(result.error.message || 'Unable to revoke other sessions.');
      return;
    }
    toast.success('Other sessions revoked');
  };

  return (
    <div className='w-full space-y-8'>
      <SettingsPageHeader
        eyebrow='Personal settings'
        title='Profile & security'
        description={
          showSessionManagement
            ? 'Keep your profile, password and active sessions under control.'
            : 'Manage the identity and password for your local account.'
        }
      />

      <Card className='border-border/70 overflow-hidden py-0 shadow-none'>
        <CardHeader className='border-border/60 bg-muted/25 border-b px-5 py-5 sm:px-6'>
          <div className='flex items-center gap-3'>
            <span className='bg-primary/10 text-primary flex size-9 items-center justify-center rounded-lg'>
              <UserCircleIcon className='size-5' weight='duotone' />
            </span>
            <div>
              <CardTitle className='text-base'>Personal information</CardTitle>
              <CardDescription className='mt-1'>
                How you appear across PARANOD.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className='grid gap-7 px-5 py-6 sm:px-6 lg:grid-cols-[180px_minmax(0,1fr)]'>
          <div className='flex items-center gap-3 lg:flex-col lg:items-start'>
            <UserAvatarProfile user={user} className='size-14' />
            <div className='min-w-0'>
              <p className='truncate text-sm font-medium'>{user.fullName}</p>
              <p className='text-muted-foreground mt-0.5 truncate text-xs'>
                {user.emailAddresses[0].emailAddress}
              </p>
              <Badge variant='outline' className='mt-2 capitalize'>
                {user.role}
              </Badge>
            </div>
          </div>

          <form onSubmit={updateProfile} className='space-y-5'>
            <div className='grid gap-4 sm:grid-cols-2'>
              <div className='space-y-2'>
                <Label htmlFor='account-name'>Full name</Label>
                <Input
                  id='account-name'
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  minLength={2}
                  disabled={savingProfile}
                  required
                />
              </div>
              <div className='space-y-2'>
                <Label htmlFor='account-email'>Email address</Label>
                <Input
                  id='account-email'
                  value={user.emailAddresses[0].emailAddress}
                  disabled
                />
              </div>
            </div>
            <div className='border-border/60 flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between'>
              <p className='text-muted-foreground text-xs'>
                Your sign-in email is managed by this installation.
              </p>
              <Button type='submit' disabled={savingProfile}>
                {savingProfile ? (
                  <Icons.spinner className='size-4 animate-spin' />
                ) : null}
                Save changes
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <section aria-labelledby='security-heading' className='space-y-4'>
        <div>
          <h2 id='security-heading' className='text-base font-semibold'>
            Sign-in & access
          </h2>
          <p className='text-muted-foreground mt-1 text-sm'>
            Security controls for this account.
          </p>
        </div>

        <div className='grid items-start gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]'>
          <Card className='border-border/70 shadow-none'>
            <CardHeader>
              <div className='flex items-center gap-3'>
                <span className='bg-primary/10 text-primary flex size-9 items-center justify-center rounded-lg'>
                  <KeyIcon className='size-5' weight='duotone' />
                </span>
                <div>
                  <CardTitle className='text-base'>Password</CardTitle>
                  <CardDescription className='mt-1'>
                    Use at least 10 characters.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <form onSubmit={updatePassword} className='space-y-4'>
                <div className='space-y-2'>
                  <Label htmlFor='current-password'>Current password</Label>
                  <Input
                    id='current-password'
                    type='password'
                    autoComplete='current-password'
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    disabled={savingPassword}
                    required
                  />
                </div>
                <div className='grid gap-4 sm:grid-cols-2'>
                  <div className='space-y-2'>
                    <Label htmlFor='new-password'>New password</Label>
                    <Input
                      id='new-password'
                      type='password'
                      autoComplete='new-password'
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      minLength={10}
                      maxLength={128}
                      disabled={savingPassword}
                      required
                    />
                  </div>
                  <div className='space-y-2'>
                    <Label htmlFor='confirm-new-password'>
                      Confirm password
                    </Label>
                    <Input
                      id='confirm-new-password'
                      type='password'
                      autoComplete='new-password'
                      value={confirmPassword}
                      onChange={(event) =>
                        setConfirmPassword(event.target.value)
                      }
                      minLength={10}
                      maxLength={128}
                      disabled={savingPassword}
                      required
                    />
                  </div>
                </div>
                <div className='border-border/60 border-t pt-4'>
                  <Button type='submit' disabled={savingPassword}>
                    {savingPassword ? (
                      <Icons.spinner className='size-4 animate-spin' />
                    ) : null}
                    Change password
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {showSessionManagement ? (
            <Card className='border-border/70 shadow-none'>
              <CardHeader>
                <div className='flex items-center gap-3'>
                  <span className='bg-primary/10 text-primary flex size-9 items-center justify-center rounded-lg'>
                    <ShieldCheckIcon className='size-5' weight='duotone' />
                  </span>
                  <div>
                    <CardTitle className='text-base'>Sessions</CardTitle>
                    <CardDescription className='mt-1'>
                      Devices with account access.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className='space-y-5'>
                <div className='rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4'>
                  <div className='flex items-center gap-2 text-sm font-medium'>
                    <CheckCircleIcon
                      className='size-4 text-emerald-500'
                      weight='fill'
                    />
                    Current session
                  </div>
                  <p className='text-muted-foreground mt-1.5 text-xs leading-5'>
                    This device stays signed in when other sessions are revoked.
                  </p>
                </div>
                <Button
                  type='button'
                  variant='outline'
                  className='w-full'
                  onClick={revokeOtherSessions}
                  disabled={revokingSessions}
                >
                  {revokingSessions ? (
                    <Icons.spinner className='size-4 animate-spin' />
                  ) : null}
                  Revoke other sessions
                </Button>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </section>
    </div>
  );
}

export default function ProfileViewPage({
  embedded = false,
  showSessionManagement = true
}: {
  embedded?: boolean;
  showSessionManagement?: boolean;
}) {
  const content = (
    <AccountContent showSessionManagement={showSessionManagement} />
  );
  return embedded ? content : <PageContainer>{content}</PageContainer>;
}
