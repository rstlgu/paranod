'use client';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useUser } from '@/lib/auth-client';
import { IconTrash, IconUser, IconShieldCheck } from '@tabler/icons-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import {
  SettingsSection,
  SettingsRow,
  settingsStyles as ui
} from '@/features/settings/settings-fields';

interface Workspace {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logo: string | null;
  role: 'admin' | 'user';
  memberCount: number;
  createdAt: string;
}

interface Member {
  id: string;
  userId: string;
  role: 'admin' | 'user';
  createdAt: string;
  user: {
    name: string;
    email: string;
    image: string | null;
  } | null;
}

export default function WorkspaceSettingsPage() {
  const { user } = useUser();

  const [loading, setLoading] = useState(true);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(
    null
  );
  const [selectedWorkspace, setSelectedWorkspace] = useState<Workspace | null>(
    null
  );
  const [members, setMembers] = useState<Member[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [membersReloadKey, setMembersReloadKey] = useState(0);
  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserRole, setNewUserRole] = useState<'user' | 'admin'>('user');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Carica workspace solo dopo che la sessione locale è pronta.
  const fetchWorkspaces = useCallback(
    async (signal?: AbortSignal) => {
      if (!user?.id) return;

      try {
        setWorkspaceError(null);
        const response = await fetch('/api/workspaces', { signal });
        if (!response.ok) throw new Error('Failed to fetch');
        const data = await response.json();
        const nextWorkspaces: Workspace[] = data.workspaces || [];
        setWorkspaces(nextWorkspaces);
        setActiveWorkspaceId(data.activeWorkspaceId);

        setSelectedWorkspace((current) => {
          const selectedId = current?.id || data.activeWorkspaceId;
          return (
            nextWorkspaces.find((workspace) => workspace.id === selectedId) ||
            nextWorkspaces[0] ||
            null
          );
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError')
          return;
        setWorkspaceError('Workspaces could not be loaded.');
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [user?.id]
  );

  useEffect(() => {
    const controller = new AbortController();
    fetchWorkspaces(controller.signal);
    return () => controller.abort();
  }, [fetchWorkspaces]);

  const selectedWorkspaceId = selectedWorkspace?.id;

  // Carica membri quando cambia l'workspace selezionata
  useEffect(() => {
    if (!selectedWorkspaceId) {
      setMembers([]);
      setMembersError(null);
      setLoadingMembers(false);
      return;
    }

    const controller = new AbortController();
    const fetchMembers = async () => {
      setLoadingMembers(true);
      setMembersError(null);
      try {
        const response = await fetch(
          `/api/workspaces/${selectedWorkspaceId}/members`,
          { signal: controller.signal }
        );
        if (!response.ok) throw new Error('Failed to fetch');
        const data = await response.json();
        setMembers(data.members || []);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError')
          return;
        setMembersError('Members could not be loaded.');
      } finally {
        if (!controller.signal.aborted) setLoadingMembers(false);
      }
    };

    fetchMembers();
    return () => controller.abort();
  }, [membersReloadKey, selectedWorkspaceId]);

  // Create a local user
  const handleCreateUser = async () => {
    if (!selectedWorkspace || !newUserEmail.trim()) return;

    setIsSubmitting(true);
    try {
      const response = await fetch(
        `/api/workspaces/${selectedWorkspace.id}/members`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: newUserEmail,
            password: newUserPassword,
            role: newUserRole
          })
        }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create user');
      }

      const data = await response.json();
      if (data.member) {
        setMembers((current) => [...current, data.member]);
      }
      setUserDialogOpen(false);
      setNewUserEmail('');
      setNewUserPassword('');
      setNewUserRole('user');
      toast.success('User created');
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to create user'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // Cambia ruolo membro
  const handleChangeRole = async (
    memberId: string,
    newRole: 'admin' | 'user'
  ) => {
    if (!selectedWorkspace) return;

    try {
      const response = await fetch(
        `/api/workspaces/${selectedWorkspace.id}/members/${memberId}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: newRole })
        }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to update');
      }

      setMembers((current) =>
        current.map((m) => (m.id === memberId ? { ...m, role: newRole } : m))
      );
      toast.success('Role updated');
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to update role'
      );
    }
  };

  // Rimuovi membro
  const handleRemoveMember = async (memberId: string) => {
    if (!selectedWorkspace) return;

    try {
      const response = await fetch(
        `/api/workspaces/${selectedWorkspace.id}/members/${memberId}`,
        { method: 'DELETE' }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to remove');
      }

      setMembers((current) => current.filter((m) => m.id !== memberId));
      toast.success('Member removed');
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to remove member'
      );
    }
  };

  const isAdmin = selectedWorkspace?.role === 'admin';

  return (
    <div>
      <SettingsSection title='Workspace'>
        {workspaceError && (
          <p role='alert' className={ui.notice}>
            {workspaceError}{' '}
            <Button className={ui.action} onClick={() => fetchWorkspaces()}>
              Retry
            </Button>
          </p>
        )}
        {loading ? (
          <Skeleton className='my-4 h-12 w-full' />
        ) : workspaces.length === 0 ? (
          <p className={ui.notice}>
            Your workspace is being initialized. Refresh this page in a moment.
          </p>
        ) : (
          <>
            <SettingsRow
              label='Workspace'
              description='Select a workspace to manage its members.'
            >
              <Select
                value={selectedWorkspace?.id}
                onValueChange={(id) =>
                  setSelectedWorkspace(
                    workspaces.find((w) => w.id === id) ?? null
                  )
                }
              >
                <SelectTrigger aria-label='Workspace'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {workspaces.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                      {w.id === activeWorkspaceId ? ' · Active' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingsRow>
            {selectedWorkspace?.description && (
              <SettingsRow label='Description'>
                <span className={ui.value}>
                  {selectedWorkspace.description}
                </span>
              </SettingsRow>
            )}
            <SettingsRow label='Your role'>
              <span className='capitalize'>{selectedWorkspace?.role}</span>
            </SettingsRow>
          </>
        )}
      </SettingsSection>
      {selectedWorkspace && (
        <SettingsSection
          title='Members'
          description='Manage who can access this workspace.'
          action={
            isAdmin && (
              <Button
                className={ui.action}
                onClick={() => setUserDialogOpen(true)}
              >
                Add member
              </Button>
            )
          }
        >
          {membersError && (
            <p role='alert' className={ui.notice}>
              {membersError}{' '}
              <Button
                className={ui.action}
                onClick={() => setMembersReloadKey((k) => k + 1)}
              >
                Retry
              </Button>
            </p>
          )}
          {loadingMembers ? (
            <Skeleton className='my-4 h-12 w-full' />
          ) : (
            members.map((member) => {
              const isCurrentUser = member.userId === user?.id;
              return (
                <SettingsRow
                  key={member.id}
                  label={
                    <span className='flex items-center gap-3'>
                      <Avatar className='size-8'>
                        {member.user?.image && (
                          <AvatarImage src={member.user.image} alt='' />
                        )}
                        <AvatarFallback>
                          {(member.user?.name || member.userId)
                            .slice(0, 2)
                            .toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span>
                        {member.user?.name ||
                          (isCurrentUser
                            ? 'You'
                            : `User ${member.userId.slice(0, 8)}`)}
                        {isCurrentUser && (
                          <span className='text-muted-foreground ml-2 text-xs'>
                            (you)
                          </span>
                        )}
                      </span>
                    </span>
                  }
                  description={member.user?.email}
                >
                  {isAdmin && !isCurrentUser ? (
                    <Select
                      value={member.role}
                      onValueChange={(v) =>
                        handleChangeRole(member.id, v as 'admin' | 'user')
                      }
                    >
                      <SelectTrigger
                        aria-label={`Role for ${member.user?.name || member.userId}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value='user'>User</SelectItem>
                        <SelectItem value='admin'>Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className='text-muted-foreground capitalize'>
                      {member.role}
                    </span>
                  )}
                  {isAdmin && !isCurrentUser && (
                    <Button
                      variant='ghost'
                      size='icon'
                      aria-label={`Remove ${member.user?.name || 'member'}`}
                      onClick={() => handleRemoveMember(member.id)}
                    >
                      <IconTrash className='size-4' />
                    </Button>
                  )}
                </SettingsRow>
              );
            })
          )}
        </SettingsSection>
      )}
      <Dialog open={userDialogOpen} onOpenChange={setUserDialogOpen}>
        <DialogContent className='settings-subdialog'>
          <DialogHeader>
            <DialogTitle>Add member</DialogTitle>
            <DialogDescription>
              {`Create login credentials for ${selectedWorkspace?.name}.`}
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-4 py-4'>
            <div className='space-y-2'>
              <Label htmlFor='user-email'>Email</Label>
              <Input
                id='user-email'
                type='email'
                placeholder='colleague@example.com'
                value={newUserEmail}
                onChange={(e) => setNewUserEmail(e.target.value)}
              />
            </div>
            {
              <div className='space-y-2'>
                <Label htmlFor='user-password'>Password</Label>
                <Input
                  id='user-password'
                  type='password'
                  minLength={10}
                  autoComplete='new-password'
                  value={newUserPassword}
                  onChange={(e) => setNewUserPassword(e.target.value)}
                />
                <p className='text-muted-foreground text-xs'>
                  Minimum 10 characters.
                </p>
              </div>
            }
            <div className='space-y-2'>
              <Label htmlFor='user-role'>Role</Label>
              <Select
                value={newUserRole}
                onValueChange={(v) => setNewUserRole(v as 'user' | 'admin')}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='user'>
                    <div className='flex items-center gap-2'>
                      <IconUser className='h-4 w-4' />
                      User
                    </div>
                  </SelectItem>
                  <SelectItem value='admin'>
                    <div className='flex items-center gap-2'>
                      <IconShieldCheck className='h-4 w-4' />
                      Admin
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setUserDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              className={ui.action}
              onClick={handleCreateUser}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Creating user...' : 'Create User'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
