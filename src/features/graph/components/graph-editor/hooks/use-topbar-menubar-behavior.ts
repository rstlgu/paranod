'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface UseTopbarMenubarBehaviorArgs {
  isActive: boolean;
}

export function useTopbarMenubarBehavior(args: UseTopbarMenubarBehaviorArgs) {
  const [openTopbarMenuId, setOpenTopbarMenuId] = useState<string | null>(null);
  const closeTopbarMenuTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  const openTopbarMenu = useCallback((id: string) => {
    if (closeTopbarMenuTimeoutRef.current) {
      clearTimeout(closeTopbarMenuTimeoutRef.current);
      closeTopbarMenuTimeoutRef.current = null;
    }
    setOpenTopbarMenuId(id);
  }, []);

  const scheduleCloseTopbarMenus = useCallback(() => {
    if (closeTopbarMenuTimeoutRef.current)
      clearTimeout(closeTopbarMenuTimeoutRef.current);
    closeTopbarMenuTimeoutRef.current = setTimeout(() => {
      setOpenTopbarMenuId(null);
    }, 220);
  }, []);

  const cancelCloseTopbarMenus = useCallback(() => {
    if (!closeTopbarMenuTimeoutRef.current) return;
    clearTimeout(closeTopbarMenuTimeoutRef.current);
    closeTopbarMenuTimeoutRef.current = null;
  }, []);

  const openTopbarMenuOnHover = useCallback(
    (id: string) => {
      // comportamento tipo Menubar: hover apre SOLO se una menu è già attiva
      if (!openTopbarMenuId) return;
      if (openTopbarMenuId === id) return;
      openTopbarMenu(id);
    },
    [openTopbarMenu, openTopbarMenuId]
  );

  useEffect(() => {
    if (!args.isActive) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpenTopbarMenuId(null);
    }

    function handleWindowBlur() {
      setOpenTopbarMenuId(null);
    }

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [args.isActive]);

  return {
    openTopbarMenuId,
    setOpenTopbarMenuId,
    openTopbarMenu,
    scheduleCloseTopbarMenus,
    cancelCloseTopbarMenus,
    openTopbarMenuOnHover
  };
}
