import Providers from '@/components/layout/providers';
import { Toaster } from '@/components/ui/sonner';
import { fontVariables } from '@/lib/font';
import ThemeProvider from '@/components/layout/ThemeToggle/theme-provider';
import { cn } from '@/lib/utils';
import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import NextTopLoader from 'nextjs-toploader';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import './globals.css';
import './theme.css';

const META_THEME_COLORS = {
  light: '#ffffff',
  dark: '#09090b'
};

export const metadata: Metadata = {
  title: 'Paranod',
  description:
    'Open-source OSINT platform with modular plugins, graph exploration and an AI agent.'
};

export const viewport: Viewport = {
  themeColor: META_THEME_COLORS.light
};

export default async function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const activeThemeValue = cookieStore.get('active_theme')?.value;
  const isScaled = activeThemeValue?.endsWith('-scaled');

  return (
    <html lang='en' suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                // Applica il tema immediatamente per evitare flash
                (function() {
                  // Legge il tema dal cookie o localStorage
                  const cookies = document.cookie.split(';');
                  let theme = null;
                  for (const cookie of cookies) {
                    const [name, value] = cookie.trim().split('=');
                    if (name === 'active_theme' && value) {
                      theme = value;
                      break;
                    }
                  }
                  if (!theme) {
                    try {
                      theme = localStorage.getItem('active_theme');
                    } catch (e) {}
                  }

                  if (theme) {
                    // Rimuove tutti i temi esistenti
                    document.body.className = document.body.className
                      .split(' ')
                      .filter(c => !c.startsWith('theme-'))
                      .join(' ');

                    // Aggiunge il nuovo tema
                    document.body.classList.add('theme-' + theme);
                    if (theme.endsWith('-scaled')) {
                      document.body.classList.add('theme-scaled');
                    }
                  }
                })();

                // Gestisce il dark mode per next-themes
                if (localStorage.theme === 'dark' || ((!('theme' in localStorage) || localStorage.theme === 'system') && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                  document.querySelector('meta[name="theme-color"]').setAttribute('content', '${META_THEME_COLORS.dark}')
                }
              } catch (_) {}
            `
          }}
        />
      </head>
      <body
        className={cn(
          'bg-background font-sans antialiased',
          activeThemeValue ? `theme-${activeThemeValue}` : '',
          isScaled ? 'theme-scaled' : '',
          fontVariables
        )}
      >
        <NextTopLoader color='var(--primary)' showSpinner={false} />
        <NuqsAdapter>
          <ThemeProvider
            attribute='class'
            defaultTheme='system'
            enableSystem
            disableTransitionOnChange
            enableColorScheme
          >
            <Providers activeThemeValue={activeThemeValue as string}>
              <Toaster />
              {children}
            </Providers>
          </ThemeProvider>
        </NuqsAdapter>
      </body>
    </html>
  );
}
