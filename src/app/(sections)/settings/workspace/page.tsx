'use client';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useUser } from '@/lib/auth-client';
import {
  IconBuilding,
  IconCrown,
  IconShieldCheck,
  IconTrash,
  IconUser,
  IconUserPlus,
  IconUsers
} from '@tabler/icons-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { SettingsPageHeader } from '@/features/settings/settings-page-header';

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
    <div className='w-full space-y-8'>
      <SettingsPageHeader
        eyebrow='Organization settings'
        title='Workspace & members'
        description='Manage access and members for this installation.'
      />

      {workspaceError && (
        <div
          role='alert'
          className='border-destructive/40 bg-destructive/5 flex items-center justify-between gap-4 rounded-xl border px-4 py-3'
        >
          <p className='text-sm'>{workspaceError}</p>
          <Button
            type='button'
            variant='outline'
            size='sm'
            onClick={() => fetchWorkspaces()}
          >
            Retry
          </Button>
        </div>
      )}

      {/* Mostra banner se non ha workspace */}
      {!loading && workspaces.length === 0 && (
        <Card className='border-primary/30 bg-primary/5 shadow-none'>
          <CardContent className='flex items-start gap-4 p-6'>
            <IconShieldCheck className='text-primary mt-1 h-6 w-6 flex-shrink-0' />
            <div className='flex-1'>
              <h3 className='mb-1 font-semibold'>Workspace Required</h3>
              <p className='text-muted-foreground text-sm'>
                {
                  'Your Workspace is being initialized. Refresh this page in a moment.'
                }
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className='grid gap-6 lg:grid-cols-[minmax(260px,320px)_minmax(0,1fr)]'>
          <Card className='border-border/70 shadow-none'>
            <CardHeader>
              <Skeleton className='h-6 w-3/4' />
            </CardHeader>
            <CardContent>
              <Skeleton className='h-24 w-full' />
            </CardContent>
          </Card>
        </div>
      ) : workspaces.length === 0 ? (
        <Card className='border-border/70 shadow-none'>
          <CardContent className='flex min-h-[300px] flex-col items-center justify-center p-8 text-center'>
            <IconBuilding className='text-muted-foreground mb-4 h-12 w-12' />
            <h3 className='mb-2 text-lg font-semibold'>
              Workspace unavailable
            </h3>
            <p className='text-muted-foreground mb-4 max-w-sm'>
              Your Workspace is created automatically during initial setup.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className='grid items-start gap-6 lg:grid-cols-[minmax(260px,300px)_minmax(0,1fr)]'>
          {/* Lista workspace */}
          <Card className='border-border/70 shadow-none lg:sticky lg:top-32'>
            <CardHeader className='border-border/60 border-b'>
              <CardTitle className='text-base'>Your Workspace</CardTitle>
              <CardDescription>Shared OSS workspace</CardDescription>
            </CardHeader>
            <CardContent className='space-y-2'>
              {workspaces.map((workspace) => (
                <button
                  type='button'
                  key={workspace.id}
                  className={`grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                    selectedWorkspace?.id === workspace.id
                      ? 'border-primary/40 bg-primary/[0.06]'
                      : 'bg-muted/25 hover:border-border hover:bg-muted/50 border-transparent'
                  }`}
                  onClick={() => setSelectedWorkspace(workspace)}
                >
                  <Avatar className='h-9 w-9'>
                    <AvatarFallback className='bg-primary/10 text-primary'>
                      {workspace.name.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className='min-w-0 space-y-2'>
                    <div className='min-w-0'>
                      <p className='truncate text-sm font-medium'>
                        {workspace.name}
                      </p>
                      <p className='text-muted-foreground text-xs'>
                        {workspace.memberCount} member
                        {workspace.memberCount !== 1 && 's'}
                      </p>
                    </div>
                    <div className='flex flex-wrap items-center gap-1.5'>
                      {activeWorkspaceId === workspace.id && (
                        <Badge variant='default' className='text-xs'>
                          Active
                        </Badge>
                      )}
                      <Badge
                        variant={
                          workspace.role === 'admin' ? 'outline' : 'secondary'
                        }
                        className='text-xs'
                      >
                        {workspace.role === 'admin' ? (
                          <IconCrown className='mr-1 h-3 w-3' />
                        ) : (
                          <IconUser className='mr-1 h-3 w-3' />
                        )}
                        {workspace.role}
                      </Badge>
                    </div>
                  </div>
                </button>
              ))}
            </CardContent>
          </Card>

          {/* Dettagli workspace */}
          {selectedWorkspace && (
            <Card className='border-border/70 min-w-0 shadow-none'>
              <CardHeader className='border-border/60 border-b'>
                <div className='flex items-start justify-between'>
                  <div>
                    <CardTitle>{selectedWorkspace.name}</CardTitle>
                    <CardDescription>
                      {selectedWorkspace.description || 'No description'}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue='members'>
                  <TabsList className='mb-5 w-full justify-start sm:w-auto'>
                    <TabsTrigger value='members' className='gap-2'>
                      <IconUsers className='h-4 w-4' />
                      Members ({members.length})
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value='members' className='space-y-4'>
                    {membersError && (
                      <div role='alert' className='rounded-md border px-4 py-3'>
                        <p className='text-sm'>{membersError}</p>
                        <p className='text-muted-foreground mt-1 text-xs'>
                          Check the connection and try again.
                        </p>
                        <Button
                          type='button'
                          variant='outline'
                          size='sm'
                          className='mt-3'
                          onClick={() =>
                            setMembersReloadKey((current) => current + 1)
                          }
                        >
                          Retry
                        </Button>
                      </div>
                    )}
                    {isAdmin && (
                      <Button
                        variant='outline'
                        onClick={() => setUserDialogOpen(true)}
                      >
                        <IconUserPlus className='mr-2 h-4 w-4' />
                        Create User
                      </Button>
                    )}

                    {loadingMembers ? (
                      <div className='space-y-2'>
                        {[1, 2].map((i) => (
                          <Skeleton key={i} className='h-14 w-full' />
                        ))}
                      </div>
                    ) : (
                      <div className='space-y-2'>
                        {members.map((member) => {
                          const isCurrentUser = member.userId === user?.id;
                          return (
                            <div
                              key={member.id}
                              className='border-border/70 flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between'
                            >
                              <div className='flex min-w-0 items-center gap-3'>
                                <Avatar className='h-9 w-9'>
                                  {member.user?.image && (
                                    <AvatarImage
                                      src={member.user.image}
                                      alt={member.user.name}
                                    />
                                  )}
                                  <AvatarFallback>
                                    {(member.user?.name || member.userId)
                                      .slice(0, 2)
                                      .toUpperCase()}
                                  </AvatarFallback>
                                </Avatar>
                                <div className='min-w-0'>
                                  <p className='truncate text-sm font-medium'>
                                    {member.user?.name ||
                                      (isCurrentUser
                                        ? 'You'
                                        : `User ${member.userId.slice(0, 8)}`)}
                                  </p>
                                  <p className='text-muted-foreground text-xs'>
                                    {isCurrentUser ? 'You' : member.user?.email}
                                    · Joined
                                    {new Date(
                                      member.createdAt
                                    ).toLocaleDateString()}
                                  </p>
                                </div>
                              </div>
                              <div className='flex shrink-0 items-center gap-2 self-end sm:self-auto'>
                                {isAdmin && !isCurrentUser ? (
                                  <Select
                                    value={member.role}
                                    onValueChange={(v) =>
                                      handleChangeRole(
                                        member.id,
                                        v as 'admin' | 'user'
                                      )
                                    }
                                  >
                                    <SelectTrigger className='w-24'>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value='user'>User</SelectItem>
                                      <SelectItem value='admin'>
                                        Admin
                                      </SelectItem>
                                    </SelectContent>
                                  </Select>
                                ) : (
                                  <Badge
                                    variant={
                                      member.role === 'admin'
                                        ? 'default'
                                        : 'secondary'
                                    }
                                  >
                                    {member.role}
                                  </Badge>
                                )}
                                {isAdmin && !isCurrentUser && (
                                  <Button
                                    variant='ghost'
                                    size='icon'
                                    onClick={() =>
                                      handleRemoveMember(member.id)
                                    }
                                  >
                                    <IconTrash className='text-destructive h-4 w-4' />
                                    <span className='sr-only'>
                                      Remove member
                                    </span>
                                  </Button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <Dialog open={userDialogOpen} onOpenChange={setUserDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create User</DialogTitle>
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
            <Button onClick={handleCreateUser} disabled={isSubmitting}>
              {isSubmitting ? 'Creating user...' : 'Create User'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
