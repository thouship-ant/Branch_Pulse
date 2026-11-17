'use client';

import { BackdateEntry } from '@/components/BackdateEntry';
import { resumeStep, startEntry, useEntry } from '@/lib/entry';
import { todayIST } from '@/lib/dates';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSession } from '@/lib/session';
import { useT, type MessageKey } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { Icon, type IconName } from './Icon';
import { LogoMark } from './Logo';
import { CommandPalette } from './CommandPalette';
import { Sheet, Skeleton, SyncBanner } from './ui';
import { useAttention } from '@/lib/useAttention';

function LangSwitch({ onDark = false }: { onDark?: boolean }) {
  const { lang, setLang, t } = useT();
  return (
    <button
      className={`flex min-h-[40px] items-center gap-1.5 rounded-full px-3 text-sm font-semibold transition ${onDark ? 'text-on-brand/90 hover:bg-white/15' : 'text-slate-600 hover:bg-slate-100'}`}
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
      className={`flex h-10 w-10 items-center justify-center rounded-full transition ${onDark ? 'text-on-brand/90 hover:bg-white/15' : 'text-slate-600 hover:bg-slate-100'}`}
      onClick={toggle} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
    >
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={19} />
    </button>
  );
}

function Avatar({ name, className = '' }: { name: string; className?: string }) {
  const initials = name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  return (
    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand to-brand-dark text-sm font-bold text-on-brand shadow-sm ${className}`} aria-hidden>{initials}</span>
  );
}

/** ADMIN -> Admin, STOCK_MANAGER -> Stock Manager (role codes are data, so any custom role reads sensibly too). */
const roleLabel = (code: string) => code.toLowerCase().split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

function Logo({ compact, onDark = false }: { compact?: boolean; onDark?: boolean }) {
  const { t } = useT();
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark size={compact ? 34 : 36} />
      {!compact && <span className={`text-[19px] font-extrabold tracking-tight ${onDark ? 'text-on-brand' : 'text-ink'}`}>{t('appName')}</span>}
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

// ------------------------------------------------------------------ branch: bottom navigation
const BRANCH_TABS: Array<{ href: string; key: MessageKey; icon: IconName }> = [
  { href: '/b/home', key: 'home', icon: 'home' },
  { href: '/b/stock', key: 'stock', icon: 'box' },
];

export function BranchShell({ children }: { children: ReactNode }) {
  const { ready, me } = useGuard('branch');
  const { t, pick } = useT();
  const { logout, can } = useSession();
  const path = usePathname();
  const entry = useEntry();
  const today = todayIST();
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
      <header className="sticky top-0 z-30 flex items-center justify-between overflow-hidden bg-gradient-to-br from-brand-dark via-brand to-brand-dark px-4 py-2.5 text-on-brand shadow-lg shadow-brand/25">
        <div className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-white/10 blur-2xl" aria-hidden />
        <div className="relative flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/20 text-sm font-bold ring-2 ring-white/30" aria-hidden>
            {me.fullName.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate text-xs text-on-brand/75">{me.fullName}</p>
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
      <BackdateEntry />
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
          {/* sales, purchases, expense and closing are one step-by-step entry for the day */}
          <button
            type="button" aria-current={entry.date ? 'page' : undefined} onClick={() => startEntry(today, resumeStep(today) ?? 0)}
            className={`flex min-h-[58px] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition ${entry.date ? 'text-brand' : 'text-slate-500'}`}
          >
            <span className={`flex h-8 w-14 items-center justify-center rounded-full transition-all duration-200 ${entry.date ? 'bg-brand-light' : ''}`}>
              <Icon name="pencil" size={21} strokeWidth={entry.date ? 2.3 : 1.9} />
            </span>
            {t('navEntry')}
          </button>
          {can('staff:view') && (
            <Link href="/b/staff" aria-current={path.startsWith('/b/staff') ? 'page' : undefined} className={`flex min-h-[58px] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition ${path.startsWith('/b/staff') ? 'text-brand' : 'text-slate-500'}`}>
              <span className={`flex h-8 w-14 items-center justify-center rounded-full transition-all duration-200 ${path.startsWith('/b/staff') ? 'bg-brand-light' : ''}`}>
                <Icon name="user" size={21} strokeWidth={path.startsWith('/b/staff') ? 2.3 : 1.9} />
              </span>
              {t('employeesTitle')}
            </Link>
          )}
        </div>
      </nav>
    </div>
  );
}

// ------------------------------------------------------------------ owner / back office
// Task-first menu (UX audit NAV-01/02/03): today's jobs first with counts, then the data areas, folded unless you are in them.
type Group = 'today' | 'money' | 'stock' | 'people' | 'admin';
const GROUPS: Array<{ id: Group; key: MessageKey; fold: boolean }> = [
  { id: 'today', key: 'navToday', fold: false }, { id: 'money', key: 'navMoney', fold: true }, { id: 'stock', key: 'navStockGroup', fold: true },
  { id: 'people', key: 'navBranchStaff', fold: true }, { id: 'admin', key: 'navAdmin', fold: false },
];
const OFFICE_LINKS: Array<{ href: string; key: MessageKey; icon: IconName; group: Group; perm?: string }> = [
  { href: '/dashboard', key: 'homeLabel', icon: 'home', group: 'today', perm: 'dashboard:view' },
  { href: '/approvals', key: 'approvals', icon: 'tick', group: 'today', perm: 'expense:approve' },
  { href: '/closings', key: 'closings', icon: 'clock', group: 'today', perm: 'closing:view' },
  { href: '/cash', key: 'cash', icon: 'wallet', group: 'today', perm: 'cash:view' },
  { href: '/orders', key: 'ordersTitle', icon: 'calendar', group: 'today', perm: 'order:view' },
  { href: '/expenses', key: 'expenses', icon: 'card', group: 'money', perm: 'expense:view' },
  { href: '/purchases', key: 'purchases', icon: 'bag', group: 'money', perm: 'purchase:view' },
  { href: '/pl', key: 'plTitle', icon: 'trend', group: 'money', perm: 'pl:view' },
  { href: '/inventory', key: 'invTitle', icon: 'box', group: 'stock', perm: 'stock:view' },
  { href: '/recipes', key: 'recipesTitle', icon: 'menu', group: 'stock', perm: 'recipe:view' },
  { href: '/branches', key: 'branches', icon: 'store', group: 'people', perm: 'location:manage' },
  { href: '/employees', key: 'employeesTitle', icon: 'user', group: 'people', perm: 'staff:view' },
  { href: '/super', key: 'companiesTitle', icon: 'store', group: 'admin', perm: 'company:manage' },
  { href: '/super/data-upload', key: 'dataUploadTitle', icon: 'box', group: 'admin', perm: 'company:manage' },
  { href: '/users', key: 'usersTitle', icon: 'users', group: 'admin', perm: 'user:manage' },
  { href: '/settings', key: 'settingsTitle', icon: 'settings', group: 'admin', perm: 'settings:manage' },
];
const MORE_TINT: Record<string, string> = {
  '/orders': 'bg-[#EFF6FF] text-[#3B82F6]', '/expenses': 'bg-[#FEF3C7] text-[#D97706]', '/purchases': 'bg-[#F3E8FF] text-[#9333EA]', '/pl': 'bg-[#DCFCE7] text-[#16A34A]',
  '/inventory': 'bg-[#E0F2FE] text-[#0284C7]', '/recipes': 'bg-[#FFE4E6] text-[#E11D48]', '/branches': 'bg-[#FEE2E2] text-[#DC2626]', '/employees': 'bg-[#EFF6FF] text-[#3B82F6]',
  '/users': 'bg-[#F3E8FF] text-[#9333EA]', '/settings': 'bg-[#FEF3C7] text-[#D97706]', '/cash': 'bg-[#DCFCE7] text-[#16A34A]', '/closings': 'bg-[#FEF3C7] text-[#D97706]',
};
const PHONE_SLOTS = 4; // the rest live under "More"

/** Name, company and role; language, theme, collapse and sign-out in one place (NAV-05). */
function AccountMenu({ me, up, children, onCollapse, collapsed }: { me: any; up?: boolean; children: ReactNode; onCollapse?: () => void; collapsed?: boolean }) {
  const { t, lang, setLang } = useT();
  const { logout } = useSession();
  const { theme, toggle } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away); window.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); window.removeEventListener('keydown', esc); };
  }, [open]);
  const row = 'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-ink transition hover:bg-slate-100';
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="block w-full text-left">{children}</button>
      {open && (
        <div role="menu" className={`anim-fade absolute z-50 w-64 rounded-2xl border border-slate-200 bg-surface p-2 ${up ? 'bottom-full left-0 mb-2' : 'right-0 top-full mt-2'}`} style={{ boxShadow: 'var(--shadow-pop)' }}>
          <div className="flex items-center gap-3 px-3 py-2.5">
            <Avatar name={me.fullName} />
            <div className="min-w-0 text-sm"><p className="truncate font-semibold">{me.fullName}</p><p className="truncate text-xs text-slate-600">{[me.company?.name, (me.roleNames?.length ? me.roleNames : me.roles.map(roleLabel)).join(', ')].filter(Boolean).join(' · ')}</p></div>
          </div>
          <div className="my-1 h-px bg-slate-200" />
          <button role="menuitem" className={row} onClick={() => setLang(lang === 'en' ? 'ta' : 'en')}><Icon name="globe" size={17} />{t('language')}<span className="ml-auto text-xs text-slate-600">{lang === 'en' ? 'தமிழ்' : 'English'}</span></button>
          <button role="menuitem" className={row} onClick={toggle}><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} />{t('darkModeLabel')}<span className="ml-auto text-xs text-slate-600">{theme === 'dark' ? 'On' : 'Off'}</span></button>
          {onCollapse && <button role="menuitem" className={`${row} hidden md:flex`} onClick={() => { onCollapse(); setOpen(false); }}><Icon name="menu" size={17} />{t('collapseMenu')}<span className="ml-auto text-xs text-slate-600">{collapsed ? 'On' : ''}</span></button>}
          <div className="my-1 h-px bg-slate-200" />
          <button role="menuitem" className={`${row} !text-red-700 hover:!bg-red-50`} onClick={() => logout()}><Icon name="logout" size={17} />{t('logout')}</button>
        </div>
      )}
    </div>
  );
}

export function OfficeShell({ children }: { children: ReactNode }) {
  const { ready, me } = useGuard('office');
  const { t } = useT();
  const { can } = useSession();
  const att = useAttention();
  const path = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [more, setMore] = useState(false);
  const [palette, setPalette] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ today: true, admin: true });

  useEffect(() => {
    try { setCollapsed(localStorage.getItem('bp_sidebar') === 'collapsed'); } catch { /* ignore */ }
  }, []);
  useEffect(() => { setMore(false); }, [path]);
  // Ctrl K / Cmd K opens search
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); } };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);
  const toggleSidebar = () => {
    setCollapsed((c) => {
      try { localStorage.setItem('bp_sidebar', c ? 'open' : 'collapsed'); } catch { /* ignore */ }
      return !c;
    });
  };

  const links = OFFICE_LINKS.filter((l) => !l.perm || can(l.perm));
  // the longest matching link wins, so /super/data-upload does not also light up /super
  const current = [...links].sort((a, b) => b.href.length - a.href.length).find((l) => path.startsWith(l.href));
  const isActive = (href: string) => current?.href === href;
  // the group you are in is always open, and the open page is scrolled into view in the menu (NAV-01)
  useEffect(() => { if (current) setOpenGroups((o) => (o[current.group] ? o : { ...o, [current.group]: true })); }, [current?.group]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { document.querySelector('[data-side-active]')?.scrollIntoView({ block: 'nearest' }); }, [path, openGroups]);

  if (!ready || !me) return <Splash />;
  // a "More" holding one page would be pointless, so that page goes on the bar instead
  const spill = links.length > PHONE_SLOTS + 1 && links.length - PHONE_SLOTS === 1;
  const phoneMain = links.length > PHONE_SLOTS + 1 && !spill ? links.slice(0, PHONE_SLOTS) : links;
  const phoneMore = links.length > PHONE_SLOTS + 1 && !spill ? links.slice(PHONE_SLOTS) : [];
  const badge = (href: string): { n: number; tone: string } =>
    href === '/approvals' ? { n: att.waiting, tone: 'bg-red-600 text-white' } : href === '/closings' ? { n: att.unclosedBranches, tone: 'bg-amber-500 text-white' } : { n: 0, tone: '' };
  const paletteItems = links.map((l) => ({ href: l.href, label: t(l.key), icon: l.icon, hint: badge(l.href).n ? `${badge(l.href).n}` : undefined }));

  return (
    <div className="min-h-dvh md:flex">
      {/* sidebar: quiet and light - one flat colour, one marker for the open page; only its own menu area scrolls */}
      <aside className={`${collapsed ? 'side-collapsed ' : ''}fixed inset-y-0 left-0 z-20 hidden h-dvh flex-col border-r border-slate-200 bg-surface transition-[width] duration-200 md:flex ${collapsed ? 'w-[76px] p-3' : 'w-[264px] p-4'}`}>
        <div className={`mb-4 flex h-11 shrink-0 items-center ${collapsed ? 'justify-center' : 'px-1'}`}><Logo compact={collapsed} /></div>
        <nav className="scroll-hover min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5" aria-label="Main">
          {GROUPS.map((g) => {
            const items = links.filter((l) => l.group === g.id);
            if (!items.length) return null;
            const open = collapsed || !g.fold || !!openGroups[g.id];
            return (
              <div key={g.id} className="space-y-0.5">
                {collapsed ? <div className="mx-3 my-1 h-px bg-slate-200" aria-hidden /> : (
                  <button type="button" disabled={!g.fold} onClick={() => setOpenGroups((o) => ({ ...o, [g.id]: !o[g.id] }))} aria-expanded={open}
                    className="flex w-full items-center justify-between px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600 disabled:cursor-default">
                    {t(g.key)}{g.fold && <Icon name="chevronDown" size={13} className={`transition-transform ${open ? '' : '-rotate-90'}`} />}
                  </button>
                )}
                {open && items.map((l) => {
                  const b = badge(l.href);
                  return (
                    <Link
                      key={l.href} href={l.href} aria-current={isActive(l.href) ? 'page' : undefined} title={collapsed ? t(l.key) : undefined} data-side-active={isActive(l.href) ? '' : undefined}
                      className={`side-item ${isActive(l.href) ? 'side-item-active' : ''}`}
                    >
                      <span className="side-ico relative"><Icon name={l.icon} size={19} strokeWidth={isActive(l.href) ? 2.3 : 1.9} />{collapsed && b.n > 0 && <span className={`absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full ${b.tone}`} />}</span>
                      {collapsed ? <span className="sr-only">{t(l.key)}</span> : <span className="flex-1 truncate">{t(l.key)}</span>}
                      {!collapsed && b.n > 0 && <span className={`ml-auto grid h-5 min-w-[20px] place-items-center rounded-full px-1.5 text-[11px] font-bold tabular-nums ${b.tone}`}>{b.n}</span>}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>
        <div className="mt-3 shrink-0 border-t border-slate-200 pt-3">
          <AccountMenu me={me} up onCollapse={toggleSidebar} collapsed={collapsed}>
            <span className={`flex items-center rounded-xl p-2 transition hover:bg-slate-100 ${collapsed ? 'justify-center' : 'gap-3'}`}>
              <Avatar name={me.fullName} />
              {!collapsed && (
                <span className="min-w-0 flex-1 text-sm">
                  <span className="block truncate font-semibold">{me.fullName}</span>
                  <span className="block truncate text-xs text-slate-600">{[me.company?.name, (me.roleNames?.length ? me.roleNames : me.roles.map(roleLabel)).join(', ')].filter(Boolean).join(' · ')}</span>
                </span>
              )}
              {!collapsed && <Icon name="chevronDown" size={15} className="shrink-0 -rotate-180 text-slate-500" />}
            </span>
          </AccountMenu>
        </div>
      </aside>

      <div className={`min-w-0 flex-1 transition-[margin] duration-200 ${collapsed ? 'md:ml-[76px]' : 'md:ml-[264px]'}`}>
        {/* top bar that earns its space: search everything, what is waiting, language, theme (NAV-04) */}
        <header className="sticky top-0 z-30 flex h-[60px] items-center gap-2 border-b border-slate-200 bg-surface/90 px-3 backdrop-blur-xl md:px-6">
          <span className="md:hidden"><Logo /></span>
          <button type="button" onClick={() => setPalette(true)} aria-label={t('searchPlaceholder')} className="ml-1 hidden h-10 w-full max-w-md items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-600 transition hover:border-slate-300 md:flex">
            <Icon name="eye" size={16} /><span className="flex-1 truncate text-left">{t('searchPlaceholder')}</span><kbd className="rounded-md border border-slate-300 bg-surface px-1.5 py-0.5 text-xs">Ctrl K</kbd>
          </button>
          <div className="ml-auto flex items-center gap-0.5">
            <button type="button" onClick={() => setPalette(true)} aria-label={t('searchShort')} className="flex h-10 w-10 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 md:hidden"><Icon name="eye" size={19} /></button>
            {can('expense:approve') && (
              <Link href="/approvals" aria-label={`${t('notificationsLabel')}: ${att.waiting}`} title={t('notificationsLabel')} className="relative flex h-10 w-10 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100">
                <Icon name="clock" size={19} />
                {att.waiting > 0 && <span className="absolute right-0.5 top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">{att.waiting}</span>}
              </Link>
            )}
            <span className="hidden sm:block"><ThemeToggle /></span>
            <span className="hidden sm:block"><LangSwitch /></span>
            <span className="md:hidden">
              <AccountMenu me={me}><span className="flex h-10 w-10 items-center justify-center"><Avatar name={me.fullName} /></span></AccountMenu>
            </span>
          </div>
        </header>
        <main className="mx-auto max-w-[1400px] space-y-5 p-4 pb-28 md:p-8 md:pb-10">{children}</main>

        <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200/80 bg-[var(--glass)] pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden" aria-label="Main">
          <div className="flex px-1.5 pt-1">
            {phoneMain.map((l) => (
              <Link key={l.href} href={l.href} aria-current={isActive(l.href) ? 'page' : undefined} className={`flex min-h-[58px] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition ${isActive(l.href) ? 'text-brand' : 'text-slate-600'}`}>
                <span className={`relative flex h-8 w-14 items-center justify-center rounded-full transition-all duration-200 ${isActive(l.href) ? 'bg-brand-light' : ''}`}>
                  <Icon name={l.icon} size={21} strokeWidth={isActive(l.href) ? 2.3 : 1.9} />
                  {badge(l.href).n > 0 && <span className={`absolute right-2 top-0 grid h-4 min-w-[16px] place-items-center rounded-full px-1 text-[10px] font-bold ${badge(l.href).tone}`}>{badge(l.href).n}</span>}
                </span>
                {t(l.key)}
              </Link>
            ))}
            {phoneMore.length > 0 && (
              <button onClick={() => setMore(true)} className={`flex min-h-[58px] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition ${phoneMore.some((l) => isActive(l.href)) ? 'text-brand' : 'text-slate-600'}`}>
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
                <span className={`grid h-11 w-11 place-items-center rounded-xl ${MORE_TINT[l.href] ?? 'bg-[#EFF6FF] text-[#3B82F6]'}`}><Icon name={l.icon} size={22} /></span>{t(l.key)}
              </Link>
            ))}
          </div>
        </Sheet>
        <CommandPalette open={palette} onClose={() => setPalette(false)} items={paletteItems} />
      </div>
    </div>
  );
}
