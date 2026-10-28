import type { Metadata, Viewport } from 'next';
import { Inter, Noto_Sans_Tamil } from 'next/font/google';
import type { ReactNode } from 'react';
import { ChangePasswordModal } from '@/components/ChangePasswordModal';
import { PwaRegister } from '@/components/PwaRegister';
import { TopLoader } from '@/components/TopLoader';
import { I18nProvider } from '@/lib/i18n';
import { SessionProvider } from '@/lib/session';
import { THEME_SCRIPT, ThemeProvider } from '@/lib/theme';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const tamil = Noto_Sans_Tamil({ subsets: ['tamil'], variable: '--font-tamil', display: 'swap' });

export const metadata: Metadata = {
  title: 'Branch Pulse',
  description: 'Multi-branch shop management: daily closing, cash, expenses and stock.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Branch Pulse', statusBarStyle: 'default' },
  icons: { icon: '/icons/icon-192.png', apple: '/icons/icon-192.png' },
};

export const viewport: Viewport = {
  themeColor: '#1e2a8a',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning: the inline script adds the "dark" class before React hydrates
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${tamil.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <ThemeProvider>
          <I18nProvider>
            <SessionProvider>{children}<ChangePasswordModal /></SessionProvider>
          </I18nProvider>
        </ThemeProvider>
        <TopLoader />
        <PwaRegister />
      </body>
    </html>
  );
}
