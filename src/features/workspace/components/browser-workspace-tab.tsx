'use client';

import * as React from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import {
  ArrowClockwiseIcon as IconRefresh,
  BrowsersIcon as IconBrowsers,
  XIcon as IconX
} from '@/components/icons';
import { useWorkspaceTabsStore } from '../store/workspace-tabs-store';

interface WorkspaceSessionView {
  id: string;
  browser: 'chrome' | 'tor';
  targetUrl: string;
  status: 'STARTING' | 'READY' | 'STOPPED' | 'FAILED';
  streamUrl: string | null;
  hostPort: number | null;
  vncPassword: string | null;
  expiresAt: string;
  error: string | null;
}

function fetcher(url: string) {
  return fetch(url).then(async (r) => {
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(json?.error || `HTTP_${r.status}`);
    return json;
  });
}

function getHostnameLabel(url: string) {
  try {
    const u = new URL(url);
    return u.hostname || url;
  } catch {
    return url;
  }
}

export interface BrowserWorkspaceTabProps {
  sessionId: string;
  isActive: boolean;
  className?: string;
}

export function BrowserWorkspaceTab(props: BrowserWorkspaceTabProps) {
  const tabId = `browser:${props.sessionId}`;
  const setTabTitle = useWorkspaceTabsStore((s) => s.setTabTitle);
  const closeTab = useWorkspaceTabsStore((s) => s.closeTab);

  const { data, error, isLoading, mutate } = useSWR(
    `/api/workspaces/sessions/${encodeURIComponent(props.sessionId)}`,
    fetcher,
    {
      revalidateOnFocus: false,
      refreshInterval: (latest) => {
        const session = (latest as any)?.data as WorkspaceSessionView | undefined;
        if (!session) return 1000;
        if (session.status === 'STARTING') return 1000;
        return 0;
      }
    }
  );

  const session = (data as any)?.data as WorkspaceSessionView | undefined;
  const [iframeSrc, setIframeSrc] = React.useState<string | null>(null);
  const [bootAttempt, setBootAttempt] = React.useState(0);

  function buildClientUrl(baseUrl: string) {
    // KasmVNC builds the websocket URL as: ws(s)://<host>:<port>/<path>
    // where <path> defaults to "websockify". Since we're mounting Kasm under
    // `/w/<sessionId>/`, we MUST override `path` to include that prefix,
    // otherwise the client tries `/websockify` on the app and stays on "Connecting…".
    const u = new URL(baseUrl);
    u.pathname = u.pathname.endsWith('/') ? u.pathname : `${u.pathname}/`;
    u.searchParams.set('resize', 'remote');
    u.searchParams.set('path', `w/${props.sessionId}/websockify`);
    return u.toString();
  }

  async function waitForStreamHttpReady(url: string, signal: AbortSignal) {
    // Traefik can take a moment to pick up new container labels; during that window
    // the first request may return 502. We preflight until we get an OK response.
    const deadlineMs = Date.now() + 15_000;
    let lastError: unknown = null;

    while (Date.now() < deadlineMs && !signal.aborted) {
      try {
        const res = await fetch(url, {
          method: 'GET',
          cache: 'no-store',
          signal,
          headers: { Accept: 'text/html' }
        });
        if (res.ok) return;
        lastError = new Error(`HTTP_${res.status}`);
      } catch (e) {
        lastError = e;
      }

      await new Promise((r) => window.setTimeout(r, 600));
    }

    throw lastError ?? new Error('stream_not_ready');
  }

  React.useEffect(() => {
    if (!session) return;
    const title = getHostnameLabel(session.targetUrl);
    setTabTitle(tabId, title);
  }, [session?.id, session?.targetUrl, setTabTitle, tabId]);

  React.useEffect(() => {
    // Kasm containers can take a few seconds before the websocket is ready.
    // Render the iframe only after a short delay, and re-render on retry.
    if (!session?.streamUrl) {
      setIframeSrc(null);
      return;
    }
    if (session.status !== 'READY') {
      setIframeSrc(null);
      return;
    }

    const abort = new AbortController();
    setIframeSrc(null);

    const t = window.setTimeout(() => {
      void (async () => {
        const u = new URL(buildClientUrl(session.streamUrl!));
        u.searchParams.set('t', String(Date.now()));
        u.searchParams.set('attempt', String(bootAttempt));

        try {
          await waitForStreamHttpReady(u.toString(), abort.signal);
          setIframeSrc(u.toString());
        } catch {
          // Leave iframeSrc null; user can retry via button.
        }
      })();
    }, 1200);

    return () => {
      abort.abort();
      window.clearTimeout(t);
    };
  }, [session?.id, session?.status, session?.streamUrl, bootAttempt]);

  async function stopSession() {
    // Close UI immediately; stop the container in background.
    closeTab(tabId);
    toast.message('Closing browser session in background…');
    void fetch(`/api/workspaces/sessions/${encodeURIComponent(props.sessionId)}`, {
      method: 'DELETE'
    }).catch(() => {});
  }

  function openPopout() {
    if (!session?.id) return;
    const url = `/popout/workspaces/sessions/${encodeURIComponent(session.id)}`;
    window.open(
      url,
      `workspace-popout-${session.id}`,
      'popup=yes,width=1200,height=800,noopener,noreferrer'
    );
  }

  function retryStream() {
    setIframeSrc(null);
    setBootAttempt((v) => v + 1);
  }

  function handleIframeLoad(e: React.SyntheticEvent<HTMLIFrameElement>) {
    // In Traefik mode, the iframe is same-origin (/w/<id>/...), so we can hide internal scrollbars.
    // In direct-port mode it may be cross-origin, so this safely no-ops.
    try {
      const doc = e.currentTarget.contentDocument;
      const root = doc?.documentElement;
      const body = doc?.body;
      if (!root || !body) return;
      root.style.overflow = 'hidden';
      body.style.overflow = 'hidden';
      body.style.margin = '0';
    } catch {
      // ignore (cross-origin)
    }
  }

  return (
    <div className={cn('flex h-full w-full flex-col overflow-hidden', props.className)}>
      <div className='relative flex h-11 w-full items-center gap-1 border-b border-border/40 bg-background/90 px-1.5 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/70 select-none dark:border-white/10'>
        <div className='min-w-0 flex-1'>
          <div className='flex min-w-0 items-center gap-2'>
            <div className='min-w-0 truncate text-sm font-semibold'>
              {session?.targetUrl ? session.targetUrl : 'Browser session'}
            </div>
            {session?.browser ? (
              <Badge variant='secondary' className='shrink-0'>
                {session.browser === 'tor' ? 'TOR' : 'SAFE'}
              </Badge>
            ) : null}
          </div>
        </div>

        <div className='flex items-center gap-1'>
          <Button
            type='button'
            variant='ghost'
            size='icon'
            onClick={openPopout}
            className="size-8 [&_svg:not([class*='size-'])]:!size-5"
            disabled={!session?.id}
            aria-label='Open in new window'
            title='Open in new window'
          >
            <IconBrowsers className='h-4 w-4' />
          </Button>

          <Button
            type='button'
            variant='ghost'
            size='icon'
            onClick={retryStream}
            className="size-8 [&_svg:not([class*='size-'])]:!size-5"
            disabled={!session?.streamUrl}
            aria-label='Reload stream'
            title='Reload stream'
          >
            <IconRefresh className='h-4 w-4' />
          </Button>

          <Button
            type='button'
            variant='destructive'
            size='icon'
            onClick={stopSession}
            className="size-8 [&_svg:not([class*='size-'])]:!size-5"
            aria-label='Close'
            title='Close'
          >
            <IconX className='h-4 w-4' />
          </Button>
        </div>
      </div>

      <div className='min-h-0 flex-1 overflow-hidden'>
        {isLoading ? (
          <div className='text-muted-foreground flex h-full items-center justify-center text-sm'>
            Starting session…
          </div>
        ) : error ? (
          <div className='flex h-full flex-col items-center justify-center gap-3 px-6 text-center'>
            <div className='text-sm font-semibold'>Failed to load session</div>
            <div className='text-muted-foreground text-sm'>{String((error as any)?.message ?? '')}</div>
            <Button type='button' variant='outline' size='sm' onClick={() => mutate()}>
              Retry
            </Button>
          </div>
        ) : !session ? (
          <div className='text-muted-foreground flex h-full items-center justify-center text-sm'>
            Session not found.
          </div>
        ) : session.status === 'FAILED' ? (
          <div className='flex h-full flex-col items-center justify-center gap-3 px-6 text-center'>
            <div className='text-sm font-semibold'>Startup failed</div>
            <div className='text-muted-foreground text-sm'>{session.error ?? 'Unknown error'}</div>
            <Separator className='my-2 w-full max-w-lg' />
            <Button type='button' variant='outline' size='sm' onClick={stopSession}>
              Close tab
            </Button>
          </div>
        ) : session.status === 'STOPPED' ? (
          <div className='text-muted-foreground flex h-full items-center justify-center text-sm'>
            Session closed.
          </div>
        ) : session.status !== 'READY' || !session.streamUrl ? (
          <div className='text-muted-foreground flex h-full items-center justify-center text-sm'>
            Preparing stream…
          </div>
        ) : !iframeSrc ? (
          <div className='text-muted-foreground flex h-full flex-col items-center justify-center gap-2 text-sm'>
            <div>Starting stream…</div>
            <div className='text-xs'>
              If you see “unexpectedly closed the connection”, try opening it in a new window and accept the certificate.
            </div>
          </div>
        ) : (
          <div className='h-full w-full overflow-hidden'>
            <iframe
              title={`workspace-${session.id}`}
              src={iframeSrc}
              className='block h-full w-full bg-black'
              scrolling='no'
              allow='clipboard-read; clipboard-write'
              style={{ border: 0 }}
              onLoad={handleIframeLoad}
            />
          </div>
        )}
      </div>

      {session?.expiresAt ? (
        <div className='text-muted-foreground flex h-9 items-center justify-between border-t border-border/40 px-3 text-xs'>
          <span className='truncate'>
            Target: <span className='text-foreground/80'>{session.targetUrl}</span>
          </span>
          <span className='shrink-0'>Expires: {new Date(session.expiresAt).toLocaleTimeString()}</span>
        </div>
      ) : null}
    </div>
  );
}
