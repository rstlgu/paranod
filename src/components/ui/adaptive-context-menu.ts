'use client';

import { useLayoutEffect, type RefObject } from 'react';

type ContextMenuSide = 'left' | 'right';

const DEFAULT_VIEWPORT_PADDING = 8;
const SUBMENU_SELECTOR = '.adaptive-context-submenu';

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function getPreferredSubmenuSide(
  menu: HTMLElement,
  anchor: HTMLElement
): ContextMenuSide {
  const parentSubmenu = anchor.closest<HTMLElement>(SUBMENU_SELECTOR);
  const side =
    parentSubmenu?.dataset.adaptiveContextSide ??
    menu.dataset.adaptiveContextSide;
  return side === 'left' ? 'left' : 'right';
}

function getSubmenuOffset(submenu: HTMLElement) {
  const storedOffset = Number(submenu.dataset.adaptiveContextOffset);
  if (Number.isFinite(storedOffset)) return storedOffset;

  const styles = window.getComputedStyle(submenu);
  const offset = Math.max(
    Number.parseFloat(styles.marginLeft) || 0,
    Number.parseFloat(styles.marginRight) || 0
  );
  submenu.dataset.adaptiveContextOffset = String(offset);
  return offset;
}

function positionSubmenus(menu: HTMLElement, viewportPadding: number) {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const submenus = menu.querySelectorAll<HTMLElement>(SUBMENU_SELECTOR);

  submenus.forEach((submenu) => {
    const anchor = submenu.parentElement;
    if (!anchor) return;

    submenu.style.maxWidth = '';
    const anchorRect = anchor.getBoundingClientRect();
    const width = submenu.offsetWidth;
    const height = submenu.offsetHeight;
    const offset = getSubmenuOffset(submenu);
    const spaceRight = viewportWidth - viewportPadding - anchorRect.right;
    const spaceLeft = anchorRect.left - viewportPadding;
    const fitsRight = width + offset <= spaceRight;
    const fitsLeft = width + offset <= spaceLeft;
    const preferredSide = getPreferredSubmenuSide(menu, anchor);

    let side = preferredSide;
    if (preferredSide === 'right' && !fitsRight && fitsLeft) side = 'left';
    if (preferredSide === 'left' && !fitsLeft && fitsRight) side = 'right';
    if (!fitsRight && !fitsLeft) {
      side = spaceRight >= spaceLeft ? 'right' : 'left';
      submenu.style.maxWidth = `${Math.max(
        0,
        (side === 'right' ? spaceRight : spaceLeft) - offset
      )}px`;
    }

    submenu.style.left = side === 'right' ? '100%' : 'auto';
    submenu.style.right = side === 'left' ? '100%' : 'auto';
    submenu.style.marginLeft = side === 'right' ? `${offset}px` : '0px';
    submenu.style.marginRight = side === 'left' ? `${offset}px` : '0px';
    submenu.style.top = `${
      clamp(
        anchorRect.top,
        viewportPadding,
        viewportHeight - viewportPadding - height
      ) - anchorRect.top
    }px`;
    submenu.dataset.adaptiveContextSide = side;
    submenu.classList.toggle('slide-in-from-left-1', side === 'right');
    submenu.classList.toggle('slide-in-from-right-1', side === 'left');

    const trigger = anchor.firstElementChild;
    const chevron = trigger?.lastElementChild;
    if (trigger instanceof HTMLButtonElement && chevron instanceof SVGElement) {
      chevron.style.transform = side === 'left' ? 'rotate(180deg)' : '';
    }
  });
}

export function useAdaptiveContextMenu(
  menuRef: RefObject<HTMLDivElement | null>,
  position: { x: number; y: number },
  viewportPadding = DEFAULT_VIEWPORT_PADDING
) {
  useLayoutEffect(() => {
    const currentMenu = menuRef.current;
    if (!currentMenu) return;
    const menu: HTMLDivElement = currentMenu;

    function updatePosition() {
      const width = menu.offsetWidth;
      const height = menu.offsetHeight;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const spaceRight = viewportWidth - viewportPadding - position.x;
      const spaceLeft = position.x - viewportPadding;
      const fitsRight = width <= spaceRight;
      const fitsLeft = width <= spaceLeft;

      let side: ContextMenuSide = 'right';
      if (!fitsRight && fitsLeft) side = 'left';
      if (!fitsRight && !fitsLeft) {
        side = spaceRight >= spaceLeft ? 'right' : 'left';
      }

      const preferredLeft = side === 'right' ? position.x : position.x - width;
      menu.style.left = `${clamp(
        preferredLeft,
        viewportPadding,
        viewportWidth - viewportPadding - width
      )}px`;
      menu.style.top = `${clamp(
        position.y,
        viewportPadding,
        viewportHeight - viewportPadding - height
      )}px`;
      menu.dataset.adaptiveContextSide = side;

      positionSubmenus(menu, viewportPadding);
    }

    const resizeObserver = new ResizeObserver(updatePosition);
    function observeSubmenus() {
      resizeObserver.observe(menu);
      menu
        .querySelectorAll<HTMLElement>(SUBMENU_SELECTOR)
        .forEach((submenu) => {
          resizeObserver.observe(submenu);
        });
    }

    observeSubmenus();
    updatePosition();

    const observer = new MutationObserver(() => {
      observeSubmenus();
      updatePosition();
    });
    observer.observe(menu, { childList: true, subtree: true });
    window.addEventListener('resize', updatePosition);

    return () => {
      observer.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener('resize', updatePosition);
    };
  }, [menuRef, position.x, position.y, viewportPadding]);
}
