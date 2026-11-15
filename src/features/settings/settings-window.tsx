'use client';

import * as Dialog from '@radix-ui/react-dialog';
import {
  Buildings,
  Gear,
  HardDrives,
  MagnifyingGlass,
  Plugs,
  PuzzlePiece,
  Robot,
  UserCircle,
  X
} from '@phosphor-icons/react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useContext, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { cn } from '@/lib/utils';
import { SETTINGS_SECTIONS, activeSettingsSection } from './settings-sections';
import {
  SettingsLayerContext,
  SettingsReturnContext,
  SettingsSurfaceContext
} from './settings-surface';
import styles from './settings-window.module.css';

const WorkspaceView = dynamic(
  () =>
    import('@/features/workspace/components/workspace-view').then(
      (m) => m.WorkspaceView
    ),
  { ssr: false }
);
const icons = {
  general: Gear,
  account: UserCircle,
  workspace: Buildings,
  agent: Robot,
  plugins: Plugs,
  addons: PuzzlePiece,
  system: HardDrives
};

export function SettingsWindow({
  children,
  direct = false
}: {
  children: React.ReactNode;
  direct?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const returnTo = useContext(SettingsReturnContext);
  const { intercepted, setIntercepted } = useContext(SettingsLayerContext);
  useEffect(() => {
    if (direct) return;
    setIntercepted(true);
    return () => setIntercepted(false);
  }, [direct, setIntercepted]);
  const opener = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState('');
  const closeButton = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const selected = activeSettingsSection(pathname, searchParams.get('tab'));
  const sections = SETTINGS_SECTIONS.filter((item) =>
    `${item.label} ${item.group} ${item.keywords}`
      .toLowerCase()
      .includes(query.trim().toLowerCase())
  );
  const groups = Array.from(new Set(sections.map((item) => item.group)));
  // A null parallel route remains mounted after navigation until its catch-all resolves.
  const open =
    pathname === '/settings' ||
    pathname.startsWith('/settings/') ||
    pathname === '/plugins' ||
    pathname.startsWith('/plugins/');
  const close = () => router.push(returnTo, { scroll: false });

  return (
    <>
      {direct && (
        <div className='relative h-full min-h-0 flex-1'>
          <WorkspaceView />
        </div>
      )}
      <Dialog.Root
        open={open && (!direct || !intercepted)}
        onOpenChange={(value) => {
          if (!value) close();
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className={styles.overlay} />
          <Dialog.Content
            className={styles.window}
            data-settings-mode={direct ? 'direct' : 'overlay'}
            aria-describedby='settings-description'
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              opener.current =
                document.activeElement instanceof HTMLElement
                  ? document.activeElement
                  : null;
              closeButton.current?.focus();
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (opener.current?.isConnected) opener.current.focus();
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') event.stopPropagation();
            }}
            onEscapeKeyDown={(event) => event.stopPropagation()}
          >
            <header className={styles.header}>
              <Dialog.Title className='text-[17px] font-medium'>
                Settings
              </Dialog.Title>
              <Dialog.Description id='settings-description' className='sr-only'>
                Manage your account, workspace, AI agent and extensions.
              </Dialog.Description>
              <Dialog.Close
                ref={closeButton}
                aria-label='Close settings'
                className={styles.close}
              >
                <X size={22} />
              </Dialog.Close>
            </header>
            <div className={styles.body}>
              <aside className={styles.sidebar}>
                <div className={styles.search}>
                  <MagnifyingGlass size={18} aria-hidden />
                  <input
                    aria-label='Search settings'
                    placeholder='Search'
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  {query && (
                    <button
                      type='button'
                      aria-label='Clear settings search'
                      onClick={() => setQuery('')}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
                <nav
                  aria-label='Settings sections'
                  className={styles.navigation}
                >
                  {groups.map((group) => (
                    <section key={group}>
                      <h2 className={styles.groupLabel}>{group}</h2>
                      <div className={styles.groupItems}>
                        {sections
                          .filter((item) => item.group === group)
                          .map((item) => {
                            const Icon = icons[item.icon];
                            return (
                              <Link
                                key={item.href}
                                href={item.href}
                                prefetch={false}
                                scroll={false}
                                aria-current={
                                  selected === item.href ? 'page' : undefined
                                }
                                className={cn(
                                  styles.item,
                                  selected === item.href && styles.selected
                                )}
                                onClick={() => {
                                  content.current?.scrollTo({ top: 0 });
                                }}
                              >
                                <Icon size={21} aria-hidden />
                                <span>{item.label}</span>
                              </Link>
                            );
                          })}
                      </div>
                    </section>
                  ))}
                  {sections.length === 0 && (
                    <p
                      className='text-muted-foreground px-2 py-4 text-sm'
                      role='status'
                    >
                      No settings found. Try “account” or “addons”.
                    </p>
                  )}
                </nav>
              </aside>
              <SettingsSurfaceContext.Provider value={true}>
                <div
                  ref={content}
                  className={styles.content}
                  key={selected}
                  data-settings-content
                >
                  {children}
                </div>
              </SettingsSurfaceContext.Provider>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
