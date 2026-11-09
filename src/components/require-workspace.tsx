'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { eventBus, EVENTS } from '@/lib/events';

interface RequireWorkspaceProps {
  children: React.ReactNode;
  hasWorkspace: boolean;
}

export function RequireWorkspace({
  children,
  hasWorkspace: initialHasWorkspace
}: RequireWorkspaceProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [hasWorkspace, setHasWorkspace] = useState(initialHasWorkspace);
  const [isChecking, setIsChecking] = useState(!initialHasWorkspace);
  const hasRedirected = useRef(false);

  // Ascolta la creazione di workspace
  useEffect(() => {
    const handleWorkspaceCreated = () => {
      setHasWorkspace(true);
      setIsChecking(false);
    };

    eventBus.on(EVENTS.WORKSPACE_CREATED, handleWorkspaceCreated);

    return () => {
      eventBus.off(EVENTS.WORKSPACE_CREATED, handleWorkspaceCreated);
    };
  }, []);

  useEffect(() => {
    // Se l'utente non ha un'workspace e non siamo già sulla pagina corretta
    if (!hasWorkspace && !hasRedirected.current) {
      // Permetti l'accesso solo alla pagina di gestione workspace
      if (pathname !== '/settings/workspace') {
        hasRedirected.current = true;
        router.replace('/settings/workspace');
        return;
      }
    }
    setIsChecking(false);
  }, [hasWorkspace, pathname, router]);

  // Mostra loading durante il check iniziale
  if (isChecking && !hasWorkspace && pathname !== '/settings/workspace') {
    return (
      <div className='flex h-screen items-center justify-center'>
        <Card className='w-[400px]'>
          <CardContent className='pt-6'>
            <div className='space-y-4'>
              <Skeleton className='h-8 w-3/4' />
              <Skeleton className='h-4 w-full' />
              <Skeleton className='h-4 w-5/6' />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
