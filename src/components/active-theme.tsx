'use client';

import {
  ReactNode,
  createContext,
  useContext,
  useEffect,
  useState
} from 'react';

const COOKIE_NAME = 'active_theme';
const DEFAULT_THEME = 'default';

/**
 * Salva il tema in modo per-dominio / per-origin (cookie host-only)
 */
function saveTheme(theme: string) {
  if (typeof window === 'undefined') return;

  // Cookie host-only: non viene condiviso tra sottodomini (ogni origin resta indipendente)
  document.cookie = `${COOKIE_NAME}=${theme}; path=/; max-age=31536000; SameSite=Lax;`;

  // Usa sempre localStorage come fallback e per cross-tab communication
  try {
    localStorage.setItem(COOKIE_NAME, theme);

    // Notifica altre tab/window del cambio tema
    // Nota: l'evento storage viene triggerato automaticamente quando localStorage cambia in altre tab
    // Ma dobbiamo dispatcharlo manualmente per la tab corrente
    const event = new StorageEvent('storage', {
      key: COOKIE_NAME,
      newValue: theme,
      oldValue: localStorage.getItem(COOKIE_NAME),
      storageArea: localStorage,
      url: window.location.href
    });
    // Non possiamo dispatchare un StorageEvent reale, quindi usiamo un custom event
    window.dispatchEvent(
      new CustomEvent('theme-change', { detail: { theme } })
    );
  } catch (e) {
    // Ignora errori di localStorage (es. in modalità privata)
  }
}

type ThemeContextType = {
  activeTheme: string;
  setActiveTheme: (theme: string) => void;
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ActiveThemeProvider({
  children,
  initialTheme
}: {
  children: ReactNode;
  initialTheme?: string;
}) {
  const [activeTheme, setActiveTheme] = useState<string>(
    () => initialTheme || DEFAULT_THEME
  );

  // Funzione per applicare il tema al DOM
  const applyTheme = (theme: string) => {
    Array.from(document.body.classList)
      .filter((className) => className.startsWith('theme-'))
      .forEach((className) => {
        document.body.classList.remove(className);
      });
    document.body.classList.add(`theme-${theme}`);
    if (theme.endsWith('-scaled')) {
      document.body.classList.add('theme-scaled');
    }
  };

  // Legge il tema dal cookie o localStorage all'inizializzazione
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Legge dal cookie (priorità)
    const cookies = document.cookie.split(';');
    let cookieTheme: string | null = null;
    for (const cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      if (name === COOKIE_NAME) {
        cookieTheme = value;
        break;
      }
    }

    // Se non c'è nel cookie, prova localStorage
    if (!cookieTheme) {
      try {
        cookieTheme = localStorage.getItem(COOKIE_NAME);
      } catch (e) {
        // Ignora errori
      }
    }

    // Se c'è un tema salvato diverso da quello iniziale, applicalo
    if (cookieTheme && cookieTheme !== activeTheme) {
      setActiveTheme(cookieTheme);
      applyTheme(cookieTheme);
    } else {
      // Applica il tema iniziale
      applyTheme(activeTheme);
    }
  }, []); // Solo all'mount

  // Aggiorna il tema quando cambia
  useEffect(() => {
    saveTheme(activeTheme);
    applyTheme(activeTheme);
  }, [activeTheme]);

  // Ascolta i cambiamenti di storage da altre tab/window e cross-subdomain
  useEffect(() => {
    if (typeof window === 'undefined') return;

    let lastThemeValue = activeTheme;

    const handleStorageChange = (e: StorageEvent) => {
      if (
        e.key === COOKIE_NAME &&
        e.newValue &&
        e.newValue !== lastThemeValue
      ) {
        lastThemeValue = e.newValue;
        setActiveTheme(e.newValue);
        applyTheme(e.newValue);
      }
    };

    const handleCustomThemeChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ theme: string }>;
      if (
        customEvent.detail?.theme &&
        customEvent.detail.theme !== lastThemeValue
      ) {
        lastThemeValue = customEvent.detail.theme;
        setActiveTheme(customEvent.detail.theme);
        applyTheme(customEvent.detail.theme);
      }
    };

    // Legge il tema da cookie o localStorage (per sincronizzazione cross-subdomain)
    const syncTheme = () => {
      // Prima prova a leggere dal cookie (ha priorità per cross-subdomain)
      const cookies = document.cookie.split(';');
      let cookieTheme: string | null = null;
      for (const cookie of cookies) {
        const [name, value] = cookie.trim().split('=');
        if (name === COOKIE_NAME && value) {
          cookieTheme = value;
          break;
        }
      }

      // Se non c'è nel cookie, prova localStorage
      if (!cookieTheme) {
        try {
          cookieTheme = localStorage.getItem(COOKIE_NAME);
        } catch (e) {
          // Ignora errori
        }
      }

      // Se c'è un tema diverso, applicalo
      if (cookieTheme && cookieTheme !== lastThemeValue) {
        lastThemeValue = cookieTheme;
        setActiveTheme(cookieTheme);
        applyTheme(cookieTheme);
      }
    };

    // Ascolta eventi storage (cross-tab)
    window.addEventListener('storage', handleStorageChange);

    // Ascolta eventi custom (stessa tab)
    window.addEventListener('theme-change', handleCustomThemeChange);

    // Controlla i cambiamenti ogni 500ms (per cross-subdomain sync più reattivo)
    const interval = setInterval(syncTheme, 500);

    // Controlla anche quando la pagina diventa visibile (utente torna da altro tab/subdomain)
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

    // Sincronizza anche quando si naviga (per SPA navigation)
    const handlePopState = () => {
      syncTheme();
    };
    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('theme-change', handleCustomThemeChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('popstate', handlePopState);
      clearInterval(interval);
    };
  }, [activeTheme]);

  return (
    <ThemeContext.Provider value={{ activeTheme, setActiveTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useThemeConfig() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error(
      'useThemeConfig must be used within an ActiveThemeProvider'
    );
  }
  return context;
}
