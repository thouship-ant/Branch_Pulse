'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useSession } from '@/lib/session';
import { useT, type MessageKey } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { Icon, type IconName } from './Icon';
import { Skeleton, SyncBanner } from './ui';

function LangSwitch() {
  const { lang, setLang, t } = useT();
  return (
    <button className="min-h-touch rounded-card px-3 text-sm font-medium text-slate-600 hover:bg-slate-100" onClick={() => setLang(lang === 'en' ? 'ta' : 'en')}>
      {t('language')}
    </button>
  );
}

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      className="flex min-h-touch min-w-touch items-center justify-center rounded-card text-slate-600 hover:bg-slate-100"
      onClick={toggle} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
    >
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
    </button>
  );
}

function Avatar({ name }: { name: string }) {
  const initials = name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  return <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-semibold text-white" aria-hidden>{initials}</span>;
}

function Logo({ compact }: { compact?: boolean }) {
  const { t } = useT();
  return (
    <div className="flex items-center gap-2 text-brand">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand text-white"><Icon name="bars" size={18} /></span>
      {!compact && <span className="text-lg font-bold text-ink">{t('appName')}</span>}
    </div>
  );
}

function Splash() {
  return (
    <div className="mx-auto max-w-md space-y-3 p-6">
      <Skeleton className="h-10" /><Skeleton className="h-32" /><Skeleton className="h-32" />
    </div>
  );
}

/** Redirect helper for guarded layouts. */
function useGuard(kind: 'branch' | 'office') {
  const { me, loading, isBranchUser } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (loading) return;
    if (!me) router.replace('/login');
    else if (kind === 'branch' && !isBranchUser) router.replace('/dashboard');
    else if (kind === 'office' && isBranchUser) router.replace('/b/home');
  }, [loading, me, isBranchUser, kind, router]);
  const ready = !loading && !!me && (kind === 'branch' ? isBranchUser : !isBranchUser);
  return { ready, me };
}

// ------------------------------------------------------------------ branch: 5-tab bottom navigation
const BRANCH_TABS: Array<{ href: string; key: MessageKey; icon: IconName }> = [
  { href: '/b/home', key: 'home', icon: 'home' },
  { href: '/b/sales', key: 'sales', icon: 'trend' },
  { href: '/b/expense', key: 'expense', icon: 'card' },
  { href: '/b/stock', key: 'stock', icon: 'box' },
  { href: '/b/closing', key: 'closing', icon: 'check' },
];

export function BranchShell({ children }: { children: ReactNode }) {
  const { ready, me } = useGuard('branch');
  const { t, pick } = useT();
  const { logout } = useSession();
  const path = usePathname();
  // warm the five branch screens so they open with no signal (service worker caches the page shells)
  useEffect(() => {
    if (!ready) return;
    navigator.serviceWorker?.ready
      .then((reg) => reg.active?.postMessage({ type: 'precache', urls: BRANCH_TABS.map((tab) => tab.href) }))
      .catch(() => undefined);
  }, [ready]);
  if (!ready || !me) return <Splash />;
  const branch = me.locations[0];

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col bg-slate-50">
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-surface px-4 py-2">
        <div className="flex items-center gap-3">
          <Avatar name={me.fullName} />
          <div>
            <p className="text-xs text-slate-500">{me.fullName}</p>
            <h1 className="text-lg font-bold leading-tight">{branch ? pick(branch.name, branch.nameTa) : t('appName')}</h1>
          </div>
        </div>
        <div className="flex items-center">
          <ThemeToggle />
          <LangSwitch />
          <button className="flex min-h-touch min-w-touch items-center justify-center rounded-card text-slate-600 hover:bg-slate-100" onClick={() => logout()} aria-label={t('logout')} title={t('logout')}>
            <Icon name="logout" />
          </button>
        </div>
      </header>
      <SyncBanner locationId={branch?.id} />
      <main className="flex-1 space-y-4 p-4 pb-24">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-40 mx-auto flex max-w-lg border-t border-slate-200 bg-surface pb-[env(safe-area-inset-bottom)]" aria-label="Main">
        {BRANCH_TABS.map((tab) => {
          // the cash reconciliation is part of the closing flow, so it keeps the Closing tab lit
          const active = path.startsWith(tab.href) || (tab.href === '/b/closing' && path.startsWith('/b/cash'));
          return (
            <Link
              key={tab.href} href={tab.href} aria-current={active ? 'page' : undefined}
              className={`flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium ${active ? 'text-brand' : 'text-slate-500'}`}
            >
              <Icon name={tab.icon} size={22} />
              {t(tab.key)}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

// ------------------------------------------------------------------ owner / back office
const OFFICE_LINKS: Array<{ href: string; key: MessageKey; icon: IconName; perm?: string }> = [
  { href: '/dashboard', key: 'dashboard', icon: 'grid', perm: 'dashboard:view' },
  { href: '/closings', key: 'closings', icon: 'check', perm: 'closing:view' },
  { href: '/cash', key: 'cash', icon: 'wallet', perm: 'cash:view' },
  { href: '/approvals', key: 'approvals', icon: 'shield', perm: 'expense:approve' },
  { href: '/branches', key: 'branches', icon: 'store', perm: 'location:manage' },
];

export function OfficeShell({ children }: { children: ReactNode }) {
  const { ready, me } = useGuard('office');
  const { t } = useT();
  const { logout, can } = useSession();
  const path = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try { setCollapsed(localStorage.getItem('bp_sidebar') === 'collapsed'); } catch { /* ignore */ }
  }, []);
  const toggleSidebar = () => {
    setCollapsed((c) => {
      try { localStorage.setItem('bp_sidebar', c ? 'open' : 'collapsed'); } catch { /* ignore */ }
      return !c;
    });
  };

  if (!ready || !me) return <Splash />;
  const links = OFFICE_LINKS.filter((l) => !l.perm || can(l.perm));
  const current = links.find((l) => path.startsWith(l.href));

  return (
    <div className="min-h-dvh bg-slate-50 md:flex">
      {/* sidebar: pinned to the window height, only the menu area scrolls if the window is very short */}
      <aside className={`sticky top-0 hidden h-dvh shrink-0 flex-col self-start border-r border-slate-200 bg-surface transition-[width] md:flex ${collapsed ? 'w-[76px] p-3' : 'w-64 p-4'}`}>
        <div className={`mb-4 flex h-10 shrink-0 items-center ${collapsed ? 'justify-center' : ''}`}><Logo compact={collapsed} /></div>
        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto" aria-label="Main">
          {!collapsed && <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{t('menu')}</p>}
          {links.map((l) => {
            const active = path.startsWith(l.href);
            return (
              <Link
                key={l.href} href={l.href} aria-current={active ? 'page' : undefined} title={collapsed ? t(l.key) : undefined}
                className={`nav-item ${active ? 'nav-item-active' : ''} ${collapsed ? 'justify-center px-0' : ''}`}
              >
                <Icon name={l.icon} />
                {collapsed ? <span className="sr-only">{t(l.key)}</span> : t(l.key)}
              </Link>
            );
          })}
        </nav>
        <div className={`shrink-0 border-t border-slate-200 pt-3 ${collapsed ? 'flex flex-col items-center gap-2' : ''}`}>
          <div className={`mb-2 flex items-center gap-3 ${collapsed ? 'justify-center' : ''}`}>
            <Avatar name={me.fullName} />
            {!collapsed && (
              <div className="min-w-0 text-sm">
                <p className="truncate font-medium">{me.fullName}</p>
                <p className="truncate text-xs text-slate-500">{me.roles.join(', ')}</p>
              </div>
            )}
          </div>
          <button className={`nav-item w-full ${collapsed ? 'justify-center px-0' : ''}`} onClick={() => logout()} title={collapsed ? t('logout') : undefined}>
            <Icon name="logout" />{collapsed ? <span className="sr-only">{t('logout')}</span> : t('logout')}
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-slate-200 bg-surface px-4 py-2">
          <div className="flex items-center gap-2">
            <button className="hidden min-h-touch min-w-touch items-center justify-center rounded-card text-slate-600 hover:bg-slate-100 md:flex" onClick={toggleSidebar} aria-label="Toggle sidebar" aria-expanded={!collapsed}>
              <Icon name="menu" />
            </button>
            <span className="md:hidden"><Logo /></span>
          </div>
          <div className="flex items-center gap-1">
            <nav aria-label="Breadcrumb" className="mr-3 hidden text-sm text-slate-500 sm:block">
              {t('appName')} <span aria-hidden>›</span> <span className="text-ink">{current ? t(current.key) : ''}</span>
            </nav>
            <ThemeToggle />
            <LangSwitch />
            <button className="flex min-h-touch min-w-touch items-center justify-center rounded-card text-slate-600 hover:bg-slate-100 md:hidden" onClick={() => logout()} aria-label={t('logout')}>
              <Icon name="logout" />
            </button>
          </div>
        </header>
        <main className="mx-auto max-w-7xl space-y-4 p-4 pb-24 md:p-6 md:pb-6">{children}</main>
        <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-slate-200 bg-surface pb-[env(safe-area-inset-bottom)] md:hidden" aria-label="Main">
          {links.map((l) => {
            const active = path.startsWith(l.href);
            return (
              <Link key={l.href} href={l.href} aria-current={active ? 'page' : undefined} className={`flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium ${active ? 'text-brand' : 'text-slate-500'}`}>
                <Icon name={l.icon} size={22} />{t(l.key)}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
