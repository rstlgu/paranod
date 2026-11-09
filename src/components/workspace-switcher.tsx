'use client';

import { useAuth } from '@/lib/auth-client';
import { eventBus, EVENTS } from '@/lib/events';
import { AlertCircle, Building2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem
} from '@/components/ui/sidebar';
import { Skeleton } from '@/components/ui/skeleton';

interface Workspace {
  id: string;
  name: string;
  slug?: string;
}

interface WorkspaceSwitcherData {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
}

export function WorkspaceSwitcher({
  displayOnly = false
}: {
  displayOnly?: boolean;
}) {
  const router = useRouter();
  const { isSignedIn, isLoaded } = useAuth();

  const [data, setData] = React.useState<WorkspaceSwitcherData | null>(null);
  const [loading, setLoading] = React.useState(true);

  // Funzione per caricare le workspace
  const fetchWorkspaces = React.useCallback(async () => {
    if (!isLoaded || !isSignedIn) {
      setLoading(false);
      return;
    }

    try {
      const response = await fetch('/api/workspaces');
      if (response.ok) {
        const result = await response.json();
        setData({
          workspaces: result.workspaces || [],
          activeWorkspaceId: result.activeWorkspaceId || null
        });

        // Se non ci sono workspace, redirect alla pagina di setup
        if (!result.workspaces || result.workspaces.length === 0) {
          router.push('/settings/workspace');
        }
      }
    } catch {
      // Silently fail, user can still use app
    } finally {
      setLoading(false);
    }
  }, [isLoaded, isSignedIn, router]);

  // Carica workspace dal server (solo dopo autenticazione)
  React.useEffect(() => {
    fetchWorkspaces();
  }, [fetchWorkspaces]);

  // Ascolta eventi di creazione/aggiornamento workspace
  React.useEffect(() => {
    const handleWorkspaceChange = () => {
      fetchWorkspaces();
    };

    eventBus.on(EVENTS.WORKSPACE_CREATED, handleWorkspaceChange);
    eventBus.on(EVENTS.WORKSPACE_UPDATED, handleWorkspaceChange);
    eventBus.on(EVENTS.WORKSPACE_DELETED, handleWorkspaceChange);

    return () => {
      eventBus.off(EVENTS.WORKSPACE_CREATED, handleWorkspaceChange);
      eventBus.off(EVENTS.WORKSPACE_UPDATED, handleWorkspaceChange);
      eventBus.off(EVENTS.WORKSPACE_DELETED, handleWorkspaceChange);
    };
  }, [fetchWorkspaces]);

  const activeWorkspace = data?.workspaces.find(
    (o) => o.id === data.activeWorkspaceId
  );

  if (displayOnly) {
    return (
      <div className='flex h-12 min-w-0 items-center gap-3 group-data-[collapsible=icon]:h-10'>
        <div
          role='img'
          aria-label='PARANOD'
          className='border-sidebar-border bg-sidebar-accent text-sidebar-foreground flex size-9 shrink-0 items-center justify-center rounded-md border text-xl font-semibold group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:text-lg'
        >
          P
        </div>
        <div className='flex min-w-0 flex-col gap-0.5 leading-none group-data-[collapsible=icon]:hidden'>
          <span className='truncate text-sm font-semibold'>PARANOD</span>
          <span className='text-muted-foreground truncate text-xs'>
            {activeWorkspace?.name || 'Workspace'}
          </span>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size='lg' disabled>
            <Skeleton className='h-8 w-8 rounded-lg' />
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  // Se non ci sono workspace, mostra un avviso
  if (!data?.workspaces || data.workspaces.length === 0) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            size='lg'
            className='text-amber-600 dark:text-amber-400'
          >
            <div className='flex aspect-square size-8 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30'>
              <AlertCircle className='size-5 text-amber-600 dark:text-amber-400' />
            </div>
            <div className='flex flex-col gap-0.5 leading-none'>
              <span className='font-semibold'>No Workspace</span>
              <span className='text-xs opacity-70'>Initializing workspace</span>
            </div>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton size='lg' disabled>
          <div className='bg-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg'>
            <Building2 className='size-5' />
          </div>
          <div className='flex flex-col gap-0.5 leading-none'>
            <span className='font-semibold'>PARANOD</span>
            <span className='text-xs opacity-70'>
              {activeWorkspace?.name || 'Your Workspace'}
            </span>
          </div>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
