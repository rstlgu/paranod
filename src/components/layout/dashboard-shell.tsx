'use client';

import { useState, useEffect } from 'react';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { SaveStatusProvider } from '@/contexts/save-status-context';
import { CircleNotchIcon as IconLoader2 } from '@/components/icons';
import AppSidebar from '@/components/layout/app-sidebar';
import Header from '@/components/layout/header';
import { AgentDock } from '@/features/agent/components/agent-dock';

interface DashboardShellProps {
  children: React.ReactNode;
  defaultOpen: boolean;
}

function DashboardLoader() {
  return (
    <div className='from-background via-background to-muted/20 fixed inset-0 z-50 flex items-center justify-center bg-gradient-to-br'>
      <div className='flex flex-col items-center gap-6'>
        {/* Logo o icona principale */}
        <div className='relative'>
          <div className='bg-primary/10 absolute inset-0 animate-pulse rounded-full blur-xl' />
          <div className='relative'>
            <IconLoader2 className='text-primary h-10 w-10 animate-spin' />
          </div>
        </div>

        {/* Testo */}
        <div className='flex flex-col items-center gap-2'>
          <p className='text-lg font-semibold tracking-tight'>
            Loading Paranod
          </p>
          <p className='text-muted-foreground text-sm'>
            Preparing your workspace...
          </p>
        </div>

        {/* Barra di progresso animata */}
        <div className='bg-muted h-1 w-48 overflow-hidden rounded-full'>
          <div className='via-primary h-full w-full origin-left animate-[shimmer_1s_ease-in-out_infinite] bg-gradient-to-r from-transparent to-transparent' />
        </div>
      </div>
    </div>
  );
}

export function DashboardShell({ children, defaultOpen }: DashboardShellProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Piccolo delay per evitare flash durante l'hydration
    const timer = setTimeout(() => {
      setMounted(true);
    }, 50);

    return () => clearTimeout(timer);
  }, []);

  // Mostra loader durante l'hydration iniziale
  if (!mounted) {
    return <DashboardLoader />;
  }

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <SaveStatusProvider>
        <AppSidebar />
        <SidebarInset className='bg-page flex flex-col overflow-hidden transition-all duration-300'>
          <Header />
          {/* page main content */}
          <AgentDock>{children}</AgentDock>
          {/* page main content ends */}
        </SidebarInset>
      </SaveStatusProvider>
    </SidebarProvider>
  );
}
