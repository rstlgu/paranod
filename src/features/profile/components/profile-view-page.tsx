'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { authClient, useUser } from '@/lib/auth-client';
import PageContainer from '@/components/layout/page-container';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { UserAvatarProfile } from '@/components/user-avatar-profile';
import {
  SettingsSection,
  SettingsRow,
  settingsStyles as ui
} from '@/features/settings/settings-fields';

function AccountContent({
  showSessionManagement
}: {
  showSessionManagement: boolean;
}) {
  const { user, isLoaded } = useUser();
  const [passwordOpen, setPasswordOpen] = useState(false);
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
    <div>
      <SettingsSection title='Profile'>
        <SettingsRow
          label='Profile picture'
          description='Your identity across Paranod.'
        >
          <UserAvatarProfile user={user} className='size-10' />
        </SettingsRow>
        <form onSubmit={updateProfile}>
          <SettingsRow label='Full name' htmlFor='account-name'>
            <Input
              id='account-name'
              value={name}
              onChange={(event) => setName(event.target.value)}
              minLength={2}
              disabled={savingProfile}
              required
            />
          </SettingsRow>
          <SettingsRow
            label='Email address'
            description='Managed by this installation.'
          >
            <span className={ui.value}>
              {user.emailAddresses[0].emailAddress}
            </span>
          </SettingsRow>
          <SettingsRow label='Account role'>
            <span className='capitalize'>{user.role}</span>
          </SettingsRow>
          <div className={ui.actions}>
            <Button
              className={ui.action}
              type='submit'
              disabled={savingProfile || name.trim() === user.fullName}
            >
              {savingProfile ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </form>
      </SettingsSection>
      <SettingsSection title='Security'>
        <SettingsRow
          label='Password'
          description='Choose a password with at least 10 characters.'
        >
          <Button
            className={ui.action}
            type='button'
            aria-expanded={passwordOpen}
            aria-controls='password-editor'
            onClick={() => setPasswordOpen(!passwordOpen)}
          >
            {passwordOpen ? 'Cancel' : 'Change password'}
          </Button>
        </SettingsRow>
        {passwordOpen && (
          <form
            id='password-editor'
            onSubmit={updatePassword}
            className={ui.editor}
          >
            <SettingsRow label='Current password' htmlFor='current-password'>
              <Input
                id='current-password'
                type='password'
                autoComplete='current-password'
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                disabled={savingPassword}
                required
              />
            </SettingsRow>
            <SettingsRow label='New password' htmlFor='new-password'>
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
            </SettingsRow>
            <SettingsRow
              label='Confirm password'
              htmlFor='confirm-new-password'
            >
              <Input
                id='confirm-new-password'
                type='password'
                autoComplete='new-password'
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                minLength={10}
                maxLength={128}
                disabled={savingPassword}
                required
              />
            </SettingsRow>
            <div className={ui.actions}>
              <Button
                className={ui.action}
                type='submit'
                disabled={savingPassword}
              >
                {savingPassword ? 'Saving…' : 'Update password'}
              </Button>
            </div>
          </form>
        )}
        {showSessionManagement && (
          <SettingsRow
            label='Other sessions'
            description='Sign out on other devices. This session will stay active.'
          >
            <Button
              className={ui.action}
              type='button'
              onClick={revokeOtherSessions}
              disabled={revokingSessions}
            >
              {revokingSessions ? 'Signing out…' : 'Sign out other devices'}
            </Button>
          </SettingsRow>
        )}
      </SettingsSection>
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
