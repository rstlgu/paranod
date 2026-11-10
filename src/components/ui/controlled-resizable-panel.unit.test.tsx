// @vitest-environment jsdom
import { StrictMode, act, useReducer, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ControlledResizablePanel } from './controlled-resizable-panel';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup
} from './resizable';
import {
  graphPanelReducer,
  graphPanelSizes,
  initialGraphPanels,
  type PanelAction
} from '@/features/graph/lib/panel-layout';
import type { ImperativePanelGroupHandle } from 'react-resizable-panels';

// Exercise the browser implementation: the package's node export omits the
// panel registration effects because it is intended for server rendering.
vi.mock('react-resizable-panels', async () => {
  const { createRequire } = await import('node:module');
  const { dirname, join } = await import('node:path');
  const entry = createRequire(import.meta.url).resolve(
    'react-resizable-panels'
  );
  return vi.importActual(
    join(dirname(entry), 'react-resizable-panels.browser.development.cjs.js')
  );
});

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
let dispatch: React.Dispatch<PanelAction>;
let group: ImperativePanelGroupHandle;
let verticalGroup: ImperativePanelGroupHandle;
let frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;

function Scene({ width = 1280, collapsedHeight = 5, dragging = false }) {
  const [state, send] = useReducer(graphPanelReducer, initialGraphPanels);
  dispatch = send;
  const sizes = graphPanelSizes(width);
  const left = useRef(28),
    right = useRef(26),
    bottom = useRef(28);
  const rightOpen = state.details || (state.notes && !state.notesDetached);
  return (
    <>
      <output>{JSON.stringify(state)}</output>
      <ResizablePanelGroup
        direction='horizontal'
        ref={(value) => {
          if (value) group = value;
        }}
      >
        <ControlledResizablePanel
          data-testid='left'
          order={1}
          open={state.sidebar}
          onOpenChange={(open) => send({ type: 'sidebar', open })}
          lastOpenSize={left}
          minSize={sizes.sidebarMin}
          maxSize={sizes.sidebarMax}
        >
          Nodes
        </ControlledResizablePanel>
        <ResizableHandle />
        <ResizablePanel
          data-testid='canvas'
          order={2}
          defaultSize={100}
          minSize={sizes.canvasMin}
        >
          <ResizablePanelGroup
            direction='vertical'
            ref={(value) => {
              if (value) verticalGroup = value;
            }}
          >
            <ResizablePanel order={1} defaultSize={95} minSize={20}>
              Graph
            </ResizablePanel>
            <ResizableHandle />
            <ControlledResizablePanel
              data-testid='console'
              dragging={dragging}
              order={2}
              open={state.bottomExpanded}
              onOpenChange={(open) => send({ type: 'bottom', open })}
              lastOpenSize={bottom}
              collapsedSize={collapsedHeight}
              minSize={25}
              maxSize={80}
            >
              Console
            </ControlledResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
        <ResizableHandle />
        <ControlledResizablePanel
          data-testid='right'
          order={3}
          open={rightOpen}
          onOpenChange={() => send({ type: 'close-right' })}
          lastOpenSize={right}
          minSize={sizes.rightMin}
          maxSize={sizes.rightMax}
        >
          {state.retainedRight === 'notes' ? (
            <span>Notes</span>
          ) : (
            <span>Details</span>
          )}
        </ControlledResizablePanel>
      </ResizablePanelGroup>
    </>
  );
}

async function flush() {
  for (let i = 0; frames.size && i < 10; i++) {
    const current = Array.from(frames.values());
    frames.clear();
    await act(async () => current.forEach((frame) => frame(0)));
  }
}
async function render(width = 1280, collapsedHeight = 5, dragging = false) {
  await act(async () =>
    root.render(
      <StrictMode>
        <Scene
          width={width}
          collapsedHeight={collapsedHeight}
          dragging={dragging}
        />
      </StrictMode>
    )
  );
  await flush();
}
async function commands(...actions: PanelAction[]) {
  await act(async () => actions.forEach((action) => dispatch(action)));
  await flush();
}
function size(name: string) {
  return Number(
    host
      .querySelector(`[data-testid="${name}"]`)!
      .getAttribute('data-panel-size')
  );
}
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener() {},
    removeEventListener() {}
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  frames.clear();
  vi.unstubAllGlobals();
});

describe('real resizable panel integration', () => {
  it('can drag a closed console open, collapse and reopen during the same gesture', async () => {
    await render();
    expect(size('console')).toBe(5);
    await render(1280, 5, true);
    // The resize library starts from the layout captured at pointer-down.
    // Its first move may still report the collapsed size.
    for (const consoleSize of [5, 35, 5, 40]) {
      await act(async () =>
        verticalGroup.setLayout([100 - consoleSize, consoleSize])
      );
      await flush();
      expect(size('console')).toBe(consoleSize);
      const state = JSON.parse(host.querySelector('output')!.textContent!);
      expect(state.bottomExpanded).toBe(consoleSize > 5);
    }
    await render(1280, 5, false);
    expect(size('console')).toBe(40);
    await commands({ type: 'toggle-bottom', tab: 'console' });
    expect(size('console')).toBe(5);
  });
  it('opens both sides and the console concurrently, including a narrow layout', async () => {
    await render(800);
    await commands(
      { type: 'sidebar', open: true },
      { type: 'details', open: true },
      { type: 'toggle-bottom', tab: 'console' }
    );
    expect(size('left')).toBeGreaterThan(0);
    expect(size('right')).toBeGreaterThan(0);
    expect(size('canvas')).toBeGreaterThanOrEqual(19.9);
    expect(size('console')).toBeGreaterThan(5);
  });
  it('keeps the last command after rapid close/open, switching right contents and docking notes', async () => {
    await render();
    await commands({ type: 'toggle-notes' });
    const rightElement = host.querySelector('[data-testid="right"]');
    await commands({ type: 'close-notes' }, { type: 'details', open: true });
    expect(host.querySelector('[data-testid="right"]')).toBe(rightElement);
    expect(size('right')).toBeGreaterThan(0);
    await commands({ type: 'toggle-notes' }, { type: 'detach-notes' });
    expect(size('right')).toBe(0);
    await commands({ type: 'details', open: true }, { type: 'attach-notes' });
    expect(size('right')).toBeGreaterThan(0);
    await commands({ type: 'toggle-right' }, { type: 'toggle-right' });
    expect(size('right')).toBeGreaterThan(0);
  });
  it('survives an agent-sized width change without closing either side', async () => {
    await render(1600);
    await commands(
      { type: 'sidebar', open: true },
      { type: 'details', open: true }
    );
    for (const width of [1100, 800, 500, 1600]) {
      await render(width);
      expect(size('left')).toBeGreaterThan(0);
      expect(size('right')).toBeGreaterThan(0);
    }
  });
  it('can reopen a side collapsed by a resize and does not leave a stale resize flag', async () => {
    await render();
    await commands({ type: 'sidebar', open: true });
    await act(async () => group.setLayout([0, 100, 0]));
    await flush();
    expect(size('left')).toBe(0);
    await commands({ type: 'sidebar', open: true });
    expect(size('left')).toBeGreaterThan(0);
  });
  it('keeps the console header usable when its collapsed percentage changes', async () => {
    await render();
    await commands({ type: 'toggle-bottom', tab: 'console' });
    await commands({ type: 'toggle-bottom', tab: 'console' });
    await render(1280, 8);
    expect(size('console')).toBe(8);
    await commands({ type: 'toggle-bottom', tab: 'console' });
    expect(size('console')).toBeGreaterThan(8);
  });
});
