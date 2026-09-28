'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useSession } from '@/lib/session';
import { useT, type MessageKey } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { Icon, type IconName } from './Icon';
import { LogoMark } from './Logo';
import { Sheet, Skeleton, SyncBanner } from './ui';

function LangSwitch({ onDark = false }: { onDark?: boolean }) {
  const { lang, setLang, t } = useT();
  return (
    <button
      className={`flex min-h-[40px] items-center gap-1.5 rounded-full px-3 text-sm font-semibold transition ${onDark ? 'text-white/90 hover:bg-white/15' : 'text-slate-600 hover:bg-slate-100'}`}
      onClick={() => setLang(lang === 'en' ? 'ta' : 'en')} aria-label="Language"
    >
      <Icon name="globe" size={16} />{t('language')}
    </button>
  );
}

function ThemeToggle({ onDark = false }: { onDark?: boolean }) {
  const { theme, toggle } = useTheme();
  return (
    <button
      className={`flex h-10 w-10 items-center justify-center rounded-full transition ${onDark ? 'text-white/90 hover:bg-white/15' : 'text-slate-600 hover:bg-slate-100'}`}
      onClick={toggle} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
    >
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={19} />
    </button>
  );
}

function Avatar({ name, className = '' }: { name: string; className?: string }) {
  const initials = name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  return (
    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand to-indigo-600 text-sm font-bold text-white shadow-sm ${className}`} aria-hidden>{initials}</span>
  );
}

function Logo({ compact }: { compact?: boolean }) {
  const { t } = useT();
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark size={compact ? 34 : 36} />
      {!compact && <span className="text-[19px] font-extrabold tracking-tight text-ink">{t('appName')}</span>}
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
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col">
      {/* branded header: the branch is the first thing you see */}
      <header className="sticky top-0 z-30 flex items-center justify-between overflow-hidden bg-gradient-to-br from-[#2456e0] via-[#3557d8] to-[#5046e5] px-4 py-2.5 text-white shadow-[0_8px_24px_-12px_rgba(37,99,235,0.65)]">
        <div className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-white/10 blur-2xl" aria-hidden />
        <div className="relative flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/20 text-sm font-bold ring-2 ring-white/30" aria-hidden>
            {me.fullName.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate text-xs text-white/75">{me.fullName}</p>
            <h1 className="truncate text-lg font-bold leading-tight">{branch ? pick(branch.name, branch.nameTa) : t('appName')}</h1>
          </div>
        </div>
        <div className="relative flex items-center">
          <ThemeToggle onDark />
          <LangSwitch onDark />
          <button className="flex h-10 w-10 items-center justify-center rounded-full text-white/90 transition hover:bg-white/15" onClick={() => logout()} aria-label={t('logout')} title={t('logout')}>
            <Icon name="logout" size={19} />
          </button>
        </div>
      </header>
      <SyncBanner locationId={branch?.id} />
      <main className="flex-1 space-y-4 p-4 pb-28">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-lg border-t border-slate-200/80 bg-[var(--glass)] pb-[env(safe-area-inset-bottom)] backdrop-blur-xl" aria-label="Main">
        <div className="flex px-1.5 pt-1">
          {BRANCH_TABS.map((tab) => {
            // the cash reconciliation is part of the closing flow, so it keeps the Closing tab lit
            const active = path.startsWith(tab.href) || (tab.href === '/b/closing' && path.startsWith('/b/cash'));
            return (
              <Link
                key={tab.href} href={tab.href} aria-current={active ? 'page' : undefined}
                className={`flex min-h-[58px] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition ${active ? 'text-brand' : 'text-slate-500'}`}
              >
                <span className={`flex h-8 w-14 items-center justify-center rounded-full transition-all duration-200 ${active ? 'bg-brand-light' : ''}`}>
                  <Icon name={tab.icon} size={21} strokeWidth={active ? 2.3 : 1.9} />
                </span>
                {t(tab.key)}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

// ------------------------------------------------------------------ owner / back office
type Group = 'overview' | 'daily' | 'money' | 'stock' | 'setup';
const GROUPS: Array<{ id: Group; key: MessageKey }> = [
  { id: 'overview', key: 'navOverview' }, { id: 'daily', key: 'navDaily' }, { id: 'money', key: 'navMoney' }, { id: 'stock', key: 'navStockGroup' }, { id: 'setup', key: 'navSetup' },
];
const OFFICE_LINKS: Array<{ href: string; key: MessageKey; icon: IconName; group: Group; perm?: string }> = [
  { href: '/dashboard', key: 'dashboard', icon: 'grid', group: 'overview', perm: 'dashboard:view' },
  { href: '/closings', key: 'closings', icon: 'check', group: 'daily', perm: 'closing:view' },
  { href: '/cash', key: 'cash', icon: 'wallet', group: 'daily', perm: 'cash:view' },
  { href: '/expenses', key: 'expenses', icon: 'card', group: 'money', perm: 'expense:view' },
  { href: '/purchases', key: 'purchases', icon: 'bag', group: 'money', perm: 'purchase:view' },
  { href: '/approvals', key: 'approvals', icon: 'shield', group: 'money', perm: 'expense:approve' },
  { href: '/inventory', key: 'invTitle', icon: 'box', group: 'stock', perm: 'stock:view' },
  { href: '/recipes', key: 'recipesTitle', icon: 'sparkle', group: 'stock', perm: 'recipe:view' },
  { href: '/branches', key: 'branches', icon: 'store', group: 'setup', perm: 'location:manage' },
];
const PHONE_SLOTS = 4; // the rest live under "More"

export function OfficeShell({ children }: { children: ReactNode }) {
  const { ready, me } = useGuard('office');
  const { t } = useT();
  const { logout, can } = useSession();
  const path = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [more, setMore] = useState(false);

  useEffect(() => {
    try { setCollapsed(localStorage.getItem('bp_sidebar') === 'collapsed'); } catch { /* ignore */ }
  }, []);
  useEffect(() => { setMore(false); }, [path]);
  const toggleSidebar = () => {
    setCollapsed((c) => {
      try { localStorage.setItem('bp_sidebar', c ? 'open' : 'collapsed'); } catch { /* ignore */ }
      return !c;
    });
  };

  if (!ready || !me) return <Splash />;
  const links = OFFICE_LINKS.filter((l) => !l.perm || can(l.perm));
  const current = links.find((l) => path.startsWith(l.href));
  const isActive = (href: string) => path.startsWith(href);
  const phoneMain = links.length > PHONE_SLOTS + 1 ? links.slice(0, PHONE_SLOTS) : links;
  const phoneMore = links.length > PHONE_SLOTS + 1 ? links.slice(PHONE_SLOTS) : [];

  return (
    <div className="min-h-dvh md:flex">
      {/* sidebar: pinned to the window height, only the menu area scrolls if the window is very short */}
      <aside className={`sticky top-0 hidden h-dvh shrink-0 flex-col self-start border-r border-slate-200/80 bg-surface transition-[width] duration-200 md:flex ${collapsed ? 'w-[76px] p-3' : 'w-[264px] p-4'}`}>
        <div className={`mb-5 flex h-11 shrink-0 items-center ${collapsed ? 'justify-center' : 'px-1'}`}><Logo compact={collapsed} /></div>
        <nav className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-0.5" aria-label="Main">
          {GROUPS.map((g) => {
            const items = links.filter((l) => l.group === g.id);
            if (!items.length) return null;
            return (
              <div key={g.id} className="space-y-1">
                {collapsed ? <div className="mx-3 my-1 h-px bg-slate-200" aria-hidden /> : <p className="px-3 pb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">{t(g.key)}</p>}
                {items.map((l) => (
                  <Link
                    key={l.href} href={l.href} aria-current={isActive(l.href) ? 'page' : undefined} title={collapsed ? t(l.key) : undefined}
                    className={`nav-item ${isActive(l.href) ? 'nav-item-active' : ''} ${collapsed ? 'justify-center px-0' : ''}`}
                  >
                    <Icon name={l.icon} size={19} />
                    {collapsed ? <span className="sr-only">{t(l.key)}</span> : t(l.key)}
                  </Link>
                ))}
              </div>
            );
          })}
        </nav>
        <div className={`mt-3 shrink-0 rounded-card border border-slate-200/80 bg-slate-50 p-2.5 ${collapsed ? 'flex flex-col items-center gap-2' : ''}`}>
          <div className={`flex items-center gap-3 ${collapsed ? 'justify-center' : ''}`}>
            <Avatar name={me.fullName} />
            {!collapsed && (
              <div className="min-w-0 flex-1 text-sm">
                <p className="truncate font-semibold">{me.fullName}</p>
                <p className="truncate text-xs text-slate-500">{me.roles.join(', ')}</p>
              </div>
            )}
            <button className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-200 hover:text-ink" onClick={() => logout()} title={t('logout')} aria-label={t('logout')}>
              <Icon name="logout" size={18} />
            </button>
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-slate-200/80 bg-[var(--glass)] px-4 py-2 backdrop-blur-xl">
          <div className="flex items-center gap-2">
            <button className="hidden h-10 w-10 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100 md:flex" onClick={toggleSidebar} aria-label="Toggle sidebar" aria-expanded={!collapsed}>
              <Icon name="menu" size={20} />
            </button>
            <span className="md:hidden"><Logo /></span>
            <nav aria-label="Breadcrumb" className="ml-1 hidden items-center gap-2 text-sm text-slate-500 sm:flex">
              {t('appName')} <Icon name="chevron" size={14} className="text-slate-400" /> <span className="font-semibold text-ink">{current ? t(current.key) : ''}</span>
            </nav>
          </div>
          <div className="flex items-center gap-0.5">
            <ThemeToggle />
            <LangSwitch />
            <button className="flex h-10 w-10 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100 md:hidden" onClick={() => logout()} aria-label={t('logout')}>
              <Icon name="logout" size={19} />
            </button>
          </div>
        </header>
        <main className="mx-auto max-w-[1400px] space-y-5 p-4 pb-28 md:p-8 md:pb-10">{children}</main>

        <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200/80 bg-[var(--glass)] pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden" aria-label="Main">
          <div className="flex px-1.5 pt-1">
            {phoneMain.map((l) => (
              <Link key={l.href} href={l.href} aria-current={isActive(l.href) ? 'page' : undefined} className={`flex min-h-[58px] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition ${isActive(l.href) ? 'text-brand' : 'text-slate-500'}`}>
                <span className={`flex h-8 w-14 items-center justify-center rounded-full transition-all duration-200 ${isActive(l.href) ? 'bg-brand-light' : ''}`}><Icon name={l.icon} size={21} strokeWidth={isActive(l.href) ? 2.3 : 1.9} /></span>
                {t(l.key)}
              </Link>
            ))}
            {phoneMore.length > 0 && (
              <button onClick={() => setMore(true)} className={`flex min-h-[58px] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition ${phoneMore.some((l) => isActive(l.href)) ? 'text-brand' : 'text-slate-500'}`}>
                <span className={`flex h-8 w-14 items-center justify-center rounded-full ${phoneMore.some((l) => isActive(l.href)) ? 'bg-brand-light' : ''}`}><Icon name="more" size={22} strokeWidth={3} /></span>
                {t('moreLabel')}
              </button>
            )}
          </div>
        </nav>
        <Sheet open={more} onClose={() => setMore(false)} title={t('moreLabel')}>
          <div className="grid grid-cols-3 gap-3">
            {phoneMore.map((l) => (
              <Link key={l.href} href={l.href} className={`flex flex-col items-center gap-2 rounded-card border p-3 text-center text-xs font-semibold transition ${isActive(l.href) ? 'border-brand/40 bg-brand-light text-brand-dark' : 'border-slate-200 hover:bg-slate-50'}`}>
                <Icon name={l.icon} size={24} />{t(l.key)}
              </Link>
            ))}
          </div>
        </Sheet>
      </div>
    </div>
  );
}
