'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useWorkspaceTabsStore } from '@/features/workspace/store/workspace-tabs-store';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Icons } from '@/components/icons';

// Regex per rilevare URL e domini
const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;
const DOMAIN_REGEX =
  /(?:^|[\s(])([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z]{2,})+)(?=[\s),.]|$)/gi;
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi;
const IP_REGEX = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

type LinkType = 'url' | 'domain' | 'email' | 'ip';

interface LinkMatch {
  text: string;
  start: number;
  end: number;
  type: LinkType;
  href?: string;
}

function findLinks(
  text: string,
  typesToFind: LinkType[] = ['url', 'domain', 'email', 'ip']
): LinkMatch[] {
  const matches: LinkMatch[] = [];

  // Find URLs
  if (typesToFind.includes('url')) {
    let match;
    while ((match = URL_REGEX.exec(text)) !== null) {
      matches.push({
        text: match[0],
        start: match.index,
        end: match.index + match[0].length,
        type: 'url',
        href: match[0]
      });
    }
    URL_REGEX.lastIndex = 0;
  }

  // Find domains (only if not already part of a URL)
  if (typesToFind.includes('domain')) {
    let match;
    while ((match = DOMAIN_REGEX.exec(text)) !== null) {
      const domain = match[1] || match[0].trim();
      const start = match.index + (match[0].length - domain.length);
      const end = start + domain.length;

      // Check if this domain is already part of a URL match
      const isPartOfUrl = matches.some(
        (m) => m.type === 'url' && start >= m.start && end <= m.end
      );

      if (!isPartOfUrl) {
        matches.push({
          text: domain,
          start,
          end,
          type: 'domain',
          href: `https://${domain}`
        });
      }
    }
    DOMAIN_REGEX.lastIndex = 0;
  }

  // Find emails
  if (typesToFind.includes('email')) {
    let match;
    while ((match = EMAIL_REGEX.exec(text)) !== null) {
      const isAlreadyMatched = matches.some(
        (m) =>
          match!.index >= m.start && match!.index + match![0].length <= m.end
      );

      if (!isAlreadyMatched) {
        matches.push({
          text: match[0],
          start: match.index,
          end: match.index + match[0].length,
          type: 'email',
          href: `mailto:${match[0]}`
        });
      }
    }
    EMAIL_REGEX.lastIndex = 0;
  }

  // Find IPs
  if (typesToFind.includes('ip')) {
    let match;
    while ((match = IP_REGEX.exec(text)) !== null) {
      const isAlreadyMatched = matches.some(
        (m) =>
          match!.index >= m.start && match!.index + match![0].length <= m.end
      );

      if (!isAlreadyMatched) {
        matches.push({
          text: match[0],
          start: match.index,
          end: match.index + match[0].length,
          type: 'ip'
        });
      }
    }
    IP_REGEX.lastIndex = 0;
  }

  // Sort by start position
  matches.sort((a, b) => a.start - b.start);

  return matches;
}

// SVG Icons inline
function ExternalLinkIcon(props: { className?: string }) {
  return (
    <svg
      xmlns='http://www.w3.workspace/2000/svg'
      width='12'
      height='12'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
      className={props.className}
    >
      <path d='M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' />
      <polyline points='15,3 21,3 21,9' />
      <line x1='10' y1='14' x2='21' y2='3' />
    </svg>
  );
}

function CopyIcon(props: { className?: string }) {
  return (
    <svg
      xmlns='http://www.w3.workspace/2000/svg'
      width='12'
      height='12'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
      className={props.className}
    >
      <rect x='9' y='9' width='13' height='13' rx='2' ry='2' />
      <path d='M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' />
    </svg>
  );
}

function ShieldIcon(props: { className?: string }) {
  return (
    <svg
      xmlns='http://www.w3.workspace/2000/svg'
      width='12'
      height='12'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
      className={props.className}
    >
      <path d='M12 2l7 4v6c0 5-3 9-7 10-4-1-7-5-7-10V6l7-4z' />
      <path d='M9 12l2 2 4-4' />
    </svg>
  );
}

function TorIcon(props: { className?: string }) {
  return (
    <svg
      xmlns='http://www.w3.workspace/2000/svg'
      width='12'
      height='12'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
      className={props.className}
    >
      <circle cx='12' cy='12' r='9' />
      <path d='M12 7c2.8 1.4 4.2 3.1 4.2 5 0 3-2 5-4.2 5S7.8 15 7.8 12c0-1.9 1.4-3.6 4.2-5z' />
      <path d='M12 7v10' />
    </svg>
  );
}

type LeaveAction = 'external' | 'safe' | 'tor';

function getHostnameOrUrl(value: string) {
  try {
    const u = new URL(value);
    return u.hostname || value;
  } catch {
    return value;
  }
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

interface LinkTooltipProps {
  href?: string;
  canOpenExternal: boolean;
  isBusy: boolean;
  onCopy: () => void;
  onOpenDialog: () => void;
}

function LinkTooltip({
  href,
  canOpenExternal,
  isBusy,
  onCopy,
  onOpenDialog
}: LinkTooltipProps) {
  return (
    <div className='bg-popover text-popover-foreground absolute left-1/2 top-0 z-50 -translate-x-1/2 -translate-y-[calc(100%+2px)] rounded-md border px-1 py-1 shadow-sm'>
      <div className='flex items-center gap-1'>
        <button
          type='button'
          className='hover:bg-accent/70 inline-flex h-7 w-7 items-center justify-center rounded disabled:opacity-50'
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!href) return;
            onCopy();
          }}
          aria-label='Copy link'
          title='Copy'
          disabled={!href || isBusy}
        >
          <CopyIcon className='h-3 w-3' />
        </button>
        <button
          type='button'
          className='hover:bg-accent/70 inline-flex h-7 w-7 items-center justify-center rounded disabled:opacity-50'
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onOpenDialog();
          }}
          aria-label='Open link options'
          title='Open'
          disabled={!canOpenExternal || isBusy}
        >
          <ExternalLinkIcon className='h-3 w-3' />
        </button>
      </div>
    </div>
  );
}

interface HighlightedLinkProps {
  match: LinkMatch;
  showTooltip: boolean;
  onHover: () => void;
  onLeave: () => void;
  singleColor?: boolean;
}

function HighlightedLink({
  match,
  showTooltip,
  onHover,
  onLeave,
  singleColor = false
}: HighlightedLinkProps) {
  const openTab = useWorkspaceTabsStore((s) => s.openTab);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<LeaveAction | null>(null);

  // Un solo colore (blu) se singleColor è true, altrimenti colori per tipo
  const colorClass = 'text-blue-500 dark:text-blue-400';

  const href = match.href;
  const isHttpHref = !!href && (href.startsWith('http://') || href.startsWith('https://'));
  const label = href ? getHostnameOrUrl(href) : match.text;

  async function copyToClipboard(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.message('Copied');
    } catch {
      toast.error('Copy failed');
    }
  }

  async function createAndOpenWorkspaceBrowser(browser: 'chrome' | 'tor') {
    if (!href) return;
    try {
      const res = await fetch('/api/workspaces/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: href, browser })
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || 'create_session_failed');
      const session = json?.data as { id: string; targetUrl: string };
      if (!session?.id) throw new Error('invalid_session_response');

      // Give the container a moment to boot so the user lands on an already-starting stream.
      await sleep(2500);

      const title = getHostnameOrUrl(session.targetUrl);
      openTab({ kind: 'browser', resourceId: session.id, title });
      setIsDialogOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to start Safe Browser';
      toast.error(msg);
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <span
      className='group/link relative inline-flex items-center gap-1 align-baseline pt-2'
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
    >
      <span
        className={`-mt-2 cursor-pointer underline decoration-dotted underline-offset-2 transition-all hover:decoration-solid ${colorClass}`}
      >
        {match.text}
      </span>
      {showTooltip ? (
        <LinkTooltip
          href={href}
          canOpenExternal={isHttpHref}
          isBusy={pendingAction !== null}
          onCopy={() => {
            const value = href || match.text;
            void copyToClipboard(value);
          }}
          onOpenDialog={() => setIsDialogOpen(true)}
        />
      ) : null}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className='sm:max-w-xl max-h-[80vh] overflow-y-auto'>
          <DialogHeader>
            <DialogTitle>You are leaving Paranod</DialogTitle>
            <DialogDescription className='break-words'>
              You are about to visit <span className='font-medium text-foreground'>{label}</span>.
              <br />
              Choose where to open it.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className='mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between'>
            <Button
              type='button'
              variant='ghost'
              onClick={() => setIsDialogOpen(false)}
              disabled={pendingAction !== null}
            >
              Cancel
            </Button>

            <div className='flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:justify-end'>
              <Button
                type='button'
                variant='outline'
                onClick={() => {
                  if (!href) return;
                  window.open(href, '_blank', 'noopener,noreferrer');
                  setIsDialogOpen(false);
                }}
                disabled={pendingAction !== null}
              >
                <span className='inline-flex items-center gap-2'>
                  <ExternalLinkIcon className='h-4 w-4' />
                  Browser tab
                </span>
              </Button>

              <Button
                type='button'
                variant='destructive'
                onClick={() => {
                  setPendingAction('tor');
                  void createAndOpenWorkspaceBrowser('tor');
                }}
                disabled={pendingAction !== null}
              >
                {pendingAction === 'tor' ? (
                  <span className='inline-flex items-center gap-2'>
                    <Icons.spinner className='h-4 w-4 animate-spin' />
                    Starting…
                  </span>
                ) : (
                  <span className='inline-flex items-center gap-2'>
                    <TorIcon className='h-4 w-4' />
                    Tor browser
                  </span>
                )}
              </Button>

              <Button
                type='button'
                className='bg-indigo-600 text-white hover:bg-indigo-700'
                onClick={() => {
                  setPendingAction('safe');
                  void createAndOpenWorkspaceBrowser('chrome');
                }}
                disabled={pendingAction !== null}
              >
                {pendingAction === 'safe' ? (
                  <span className='inline-flex items-center gap-2'>
                    <Icons.spinner className='h-4 w-4 animate-spin' />
                    Starting…
                  </span>
                ) : (
                  <span className='inline-flex items-center gap-2'>
                    <ShieldIcon className='h-4 w-4' />
                    Safe browser
                  </span>
                )}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </span>
  );
}

interface LinkableTextProps {
  text: string;
  className?: string;
  truncate?: boolean;
  maxLength?: number;
  /** Se true, rileva solo URL e domini (per i nodi del grafo) */
  onlyUrlsAndDomains?: boolean;
}

export function LinkableText({
  text,
  className = '',
  truncate = false,
  maxLength = 100,
  onlyUrlsAndDomains = false
}: LinkableTextProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  // Determina quali tipi cercare
  const typesToFind: LinkType[] = onlyUrlsAndDomains
    ? ['url', 'domain']
    : ['url', 'domain', 'email', 'ip'];

  const matches = useMemo(
    () => findLinks(text, typesToFind),
    [text, typesToFind]
  );

  const displayText = useMemo(() => {
    if (truncate && text.length > maxLength) {
      return text.substring(0, maxLength) + '...';
    }
    return text;
  }, [text, truncate, maxLength]);

  const truncatedMatches = useMemo(() => {
    if (!truncate || text.length <= maxLength) return matches;
    return matches.filter((m) => m.start < maxLength);
  }, [matches, truncate, text.length, maxLength]);

  // If no matches, just render the text
  if (truncatedMatches.length === 0) {
    return <span className={className}>{displayText}</span>;
  }

  // Build parts with matches
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;

  truncatedMatches.forEach((match, index) => {
    // Add text before the match
    if (match.start > lastIndex) {
      const beforeText = displayText.substring(
        lastIndex,
        Math.min(match.start, displayText.length)
      );
      if (beforeText) {
        parts.push(<span key={`text-${index}`}>{beforeText}</span>);
      }
    }

    // Add the match (if it's within the display text)
    if (match.start < displayText.length) {
      const matchEnd = Math.min(match.end, displayText.length);
      const matchText = {
        ...match,
        text: displayText.substring(match.start, matchEnd)
      };

      parts.push(
        <HighlightedLink
          key={`link-${index}`}
          match={matchText}
          showTooltip={activeIndex === index}
          onHover={() => setActiveIndex(index)}
          onLeave={() => setActiveIndex(null)}
          singleColor={true}
        />
      );
    }

    lastIndex = match.end;
  });

  // Add remaining text
  if (lastIndex < displayText.length) {
    parts.push(<span key='text-end'>{displayText.substring(lastIndex)}</span>);
  }

  return <span className={className}>{parts}</span>;
}

export default LinkableText;
