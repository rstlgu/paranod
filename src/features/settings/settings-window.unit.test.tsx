// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  pathname: '/settings/account',
  push: vi.fn()
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
  usePathname: () => mocks.pathname,
  useSearchParams: () => new URLSearchParams()
}));
vi.mock('next/dynamic', () => ({
  default: () => () => <div>Workspace background</div>
}));
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: any) => {
    const anchorProps = { ...props };
    delete anchorProps.prefetch;
    delete anchorProps.scroll;
    return (
      <a href={href} {...anchorProps}>
        {children}
      </a>
    );
  }
}));
import { SettingsWindow } from './settings-window';
import {
  SettingsLayerContext,
  SettingsReturnContext
} from './settings-surface';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
function Scene({ intercept = false }) {
  const [intercepted, setIntercepted] = useState(false);
  return (
    <SettingsLayerContext.Provider value={{ intercepted, setIntercepted }}>
      <SettingsReturnContext.Provider value='/cases?view=list'>
        <SettingsWindow direct>
          <p>Direct view</p>
        </SettingsWindow>
        {intercept && (
          <SettingsWindow>
            <p>Intercepted view</p>
          </SettingsWindow>
        )}
      </SettingsReturnContext.Provider>
    </SettingsLayerContext.Provider>
  );
}
beforeEach(() => {
  mocks.pathname = '/settings/account';
  mocks.push.mockReset();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('settings window lifecycle', () => {
  it('never stacks a direct-route dialog under an intercepted dialog', async () => {
    await act(async () => root.render(<Scene intercept />));
    expect(document.querySelectorAll('[role="dialog"]').length).toBe(1);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      'Intercepted view'
    );
    await act(async () => root.render(<Scene />));
    expect(document.querySelectorAll('[role="dialog"]').length).toBe(1);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      'Direct view'
    );
  });
  it('closes to the originating application location rather than the last settings section', async () => {
    await act(async () => root.render(<Scene intercept />));
    const close = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Close settings"]'
    )!;
    await act(async () => close.click());
    expect(mocks.push).toHaveBeenCalledWith('/cases?view=list', {
      scroll: false
    });
  });
  it('does not leave a dialog or scroll lock after leaving settings', async () => {
    await act(async () => root.render(<Scene intercept />));
    mocks.pathname = '/cases';
    await act(async () => root.render(<Scene intercept />));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.style.pointerEvents).not.toBe('none');
  });
});
