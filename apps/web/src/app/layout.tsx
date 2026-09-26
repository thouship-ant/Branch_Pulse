import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { PwaRegister } from '@/components/PwaRegister';
import { I18nProvider } from '@/lib/i18n';
import { SessionProvider } from '@/lib/session';
import { THEME_SCRIPT, ThemeProvider } from '@/lib/theme';
import './globals.css';

export const metadata: Metadata = {
  title: 'Branch Pulse',
  description: 'Multi-branch shop management: daily closing, cash, expenses and stock.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Branch Pulse', statusBarStyle: 'default' },
  icons: { icon: '/icons/icon-192.png', apple: '/icons/icon-192.png' },
};

export const viewport: Viewport = {
  themeColor: '#2563eb',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning: the inline script adds the "dark" class before React hydrates
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <ThemeProvider>
          <I18nProvider>
            <SessionProvider>{children}</SessionProvider>
          </I18nProvider>
        </ThemeProvider>
        <PwaRegister />
      </body>
    </html>
  );
}
