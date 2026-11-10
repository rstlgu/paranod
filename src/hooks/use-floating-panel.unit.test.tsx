// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFloatingPanel } from './use-floating-panel';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
let width = 1200,
  height = 800;
const observers = new Set<() => void>();
function Floating({ name, open }: { name: string; open: boolean }) {
  const panel = useFloatingPanel({ isDetached: open });
  return (
    <div
      ref={panel.floatingBoundsRef}
      data-name={name}
      onPointerDownCapture={panel.bringToFront}
      onFocusCapture={panel.bringToFront}
      style={{ zIndex: panel.floatingZIndex }}
    >
      <div
        data-header={name}
        onPointerDown={(event) => panel.beginFloatingInteraction(event)}
      >
        Drag
      </div>
      <output>{JSON.stringify(panel.floatingRect)}</output>
    </div>
  );
}
async function render(open = true, second = false) {
  await act(async () =>
    root.render(
      <>
        <Floating name='notes' open={open} />
        {second && <Floating name='agent' open />}
      </>
    )
  );
}
async function pointer(target: EventTarget, type: string, x = 100, y = 100) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: x,
    clientY: y
  });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  await act(async () => {
    target.dispatchEvent(event);
  });
}
beforeEach(() => {
  width = 1200;
  height = 800;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => ({
      width,
      height,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      toJSON() {}
    })
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      callback: () => void;
      constructor(callback: () => void) {
        this.callback = callback;
        observers.add(callback);
      }
      observe() {}
      disconnect() {
        observers.delete(this.callback);
      }
    }
  );
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  observers.clear();
});

describe('floating panel lifecycle', () => {
  it('ends drag and restores global styles when closed or reattached', async () => {
    await render();
    await pointer(host.querySelector('[data-header="notes"]')!, 'pointerdown');
    expect(document.body.style.cursor).toBe('move');
    expect(document.body.style.userSelect).toBe('none');
    await render(false);
    expect(document.body.style.cursor).toBe('');
    expect(document.body.style.userSelect).toBe('');
    const previous = host.querySelector('output')!.textContent;
    await pointer(window, 'pointermove', 400, 400);
    expect(host.querySelector('output')!.textContent).toBe(previous);
    await render();
    await pointer(host.querySelector('[data-header="notes"]')!, 'pointerdown');
    await act(async () => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(document.body.style.cursor).toBe('');
  });
  it('refits on container resize and allows either overlapping window to come forward', async () => {
    await render(true, true);
    width = 320;
    height = 240;
    await act(async () => observers.forEach((callback) => callback()));
    const rect = JSON.parse(host.querySelector('output')!.textContent!);
    expect(rect.width).toBeLessThanOrEqual(width);
    expect(rect.height).toBeLessThanOrEqual(height);
    const notes = host.querySelector<HTMLElement>('[data-name="notes"]')!;
    const agent = host.querySelector<HTMLElement>('[data-name="agent"]')!;
    await pointer(notes, 'pointerdown');
    expect(Number(notes.style.zIndex)).toBeGreaterThan(
      Number(agent.style.zIndex)
    );
    await pointer(agent, 'pointerdown');
    expect(Number(agent.style.zIndex)).toBeGreaterThan(
      Number(notes.style.zIndex)
    );
    expect(Number(agent.style.zIndex)).toBeLessThan(50);
  });
});
