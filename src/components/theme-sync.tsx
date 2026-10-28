'use client';

import { useTheme } from 'next-themes';
import { useEffect } from 'react';

const THEME_STORAGE_KEY = 'theme';
const THEME_COOKIE_NAME = 'next-themes-theme';

/**
 * Salva il tema dark/light (per-dominio / per-origin)
 */
function saveThemeMode(theme: string) {
  if (typeof window === 'undefined') return;

  // Cookie host-only: non viene condiviso tra sottodomini (ogni origin resta indipendente)
  document.cookie = `${THEME_COOKIE_NAME}=${theme}; path=/; max-age=31536000; SameSite=Lax;`;

  // Sincronizza anche con localStorage (next-themes lo usa di default)
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);

    // Notifica altre tab/window del cambio tema
    window.dispatchEvent(
      new CustomEvent('next-themes-change', { detail: { theme } })
    );
  } catch (e) {
    // Ignora errori di localStorage (es. in modalità privata)
  }
}

/**
 * Componente che sincronizza il tema dark/light di next-themes tra sottodomini
 */
export function ThemeSync() {
  const { theme, setTheme } = useTheme();

  // Salva il tema quando cambia
  useEffect(() => {
    if (theme) {
      saveThemeMode(theme);
    }
  }, [theme]);

  // Sincronizza il tema tra tab dello stesso dominio (localStorage event)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    let lastThemeValue = theme || 'system';

    const handleStorageChange = (e: StorageEvent) => {
      if (
        e.key === THEME_STORAGE_KEY &&
        e.newValue &&
        e.newValue !== lastThemeValue
      ) {
        lastThemeValue = e.newValue;
        setTheme(e.newValue);
      }
    };

    const handleCustomThemeChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ theme: string }>;
      if (
        customEvent.detail?.theme &&
        customEvent.detail.theme !== lastThemeValue
      ) {
        lastThemeValue = customEvent.detail.theme;
        setTheme(customEvent.detail.theme);
      }
    };

    // Legge il tema da cookie o localStorage (per sincronizzazione cross-subdomain)
    const syncTheme = () => {
      // Prima prova a leggere dal cookie (host-only)
      const cookies = document.cookie.split(';');
      let cookieTheme: string | null = null;
      for (const cookie of cookies) {
        const [name, value] = cookie.trim().split('=');
        if (name === THEME_COOKIE_NAME && value) {
          cookieTheme = value;
          break;
        }
      }

      // Se non c'è nel cookie, prova localStorage
      if (!cookieTheme) {
        try {
          cookieTheme = localStorage.getItem(THEME_STORAGE_KEY);
        } catch (e) {
          // Ignora errori
        }
      }

      // Se c'è un tema diverso e non è 'system', applicalo
      if (cookieTheme && cookieTheme !== lastThemeValue) {
        lastThemeValue = cookieTheme;
        setTheme(cookieTheme);
      }
    };

    // Ascolta eventi storage (cross-tab)
    window.addEventListener('storage', handleStorageChange);

    // Ascolta eventi custom (stessa tab)
    window.addEventListener('next-themes-change', handleCustomThemeChange);

    // Controlla i cambiamenti ogni 500ms (per cross-subdomain sync)
    const interval = setInterval(syncTheme, 500);

    // Controlla anche quando la pagina diventa visibile
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        syncTheme();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Sincronizza anche al focus della window
    const handleFocus = () => {
      syncTheme();
    };
    window.addEventListener('focus', handleFocus);

    // Sincronizza anche quando si naviga
    const handlePopState = () => {
      syncTheme();
    };
    window.addEventListener('popstate', handlePopState);

    // Prima sync immediata (cookie/localStorage)
    syncTheme();

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('next-themes-change', handleCustomThemeChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('popstate', handlePopState);
      clearInterval(interval);
    };
  }, [theme, setTheme]);

  return null; // Questo componente non renderizza nulla
}
