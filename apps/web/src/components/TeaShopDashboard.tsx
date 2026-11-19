'use client';

import Link from 'next/link';
import { mdiCartOutline, mdiCoffee, mdiCreditCardOutline, mdiDeleteOutline, mdiPurseOutline, mdiQrcodeScan, mdiScaleBalance } from '@mdi/js';
import { Icon, type IconName, MdiIcon } from '@/components/Icon';
import { prettyDate, todayIST } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { formatINR } from '@/lib/money';
import { useSession } from '@/lib/session';
import styles from './TeaShopDashboard.module.css';

type Tiles = {
  totalSales: string;
  totalExpenses: string;
  netOperating: string;
  totalPurchases: string;
  cash: string;
  upi: string;
  card: string;
  wastage: string;
  supplierOutstanding: string;
};

type Tone = 'blue' | 'yellow' | 'green' | 'purple' | 'cyan' | 'red';
type Metric = { title: string; amount: string; icon: IconName; tone: Tone; href: string; mdi?: string; note?: string; noteTone?: 'up' | 'down' };

export function TeaShopHomeOverview({ summary, pendingCount, exceptionCount, periodLabel }: {
  summary: { tiles: Tiles & { branchCount?: number; pendingClosings?: number }; branches?: unknown[] };
  pendingCount: number;
  exceptionCount: number;
  periodLabel: string;
}) {
  const { t } = useT();
  const { me } = useSession();
  const tiles = summary.tiles;
  const today = todayIST();
  const branchCount = Number(tiles.branchCount ?? summary.branches?.length ?? 0);
  const closedCount = Math.max(0, branchCount - Number(tiles.pendingClosings ?? pendingCount));
  const greeting = new Date().getHours() < 12 ? t('goodMorning') : new Date().getHours() < 17 ? t('goodAfternoon') : t('goodEvening');

  const homeMetrics = [
    { title: `${t('totalSales')} · ${periodLabel}`, amount: formatINR(tiles.totalSales, { decimals: false }), icon: 'trend' as const, style: 'homeStatSales' as const, href: '/pl' },
    { title: t('cash'), amount: tiles.cash == null ? t('notCounted') : formatINR(tiles.cash, { decimals: false }), icon: 'wallet' as const, style: 'homeStatCash' as const, href: '/cash' },
    { title: `${t('expenses')} · ${periodLabel}`, amount: formatINR(tiles.totalExpenses, { decimals: false }), icon: 'card' as const, style: 'homeStatExpenses' as const, href: '/expenses' },
    { title: t('rOutstanding'), amount: formatINR(tiles.supplierOutstanding, { decimals: false }), icon: 'store' as const, style: 'homeStatSupplier' as const, href: '/purchases' },
  ];

  return (
    <section className={styles.homeOverview} aria-label="Dashboard overview">
      <div className={styles.homeHero}>
        <h1>{greeting}, {me?.fullName}<span aria-hidden> 👋</span></h1>
        <p>{prettyDate(today)} · {closedCount} / {branchCount} {t('attClosedToday')}</p>
      </div>
      {(pendingCount > 0 || exceptionCount > 0) && (
        <div className={styles.homeWarning} role="status">
          <Icon name="alert" size={23} />
          <div className={styles.homeWarningCopy}>
            {pendingCount > 0 && <strong>{pendingCount} {t('exClosingPending')}</strong>}
            {exceptionCount > 0 && <p>{t('attTitle')} · {exceptionCount}</p>}
          </div>
          <Link className={styles.homeWarningAction} href={exceptionCount > 0 ? '/approvals' : '/closings'}>{t('attReview')} <Icon name="chevronRight" size={17} /></Link>
        </div>
      )}
      <div className={styles.homeStatsGrid}>
        {homeMetrics.map((metric) => (
          <Link className={`${styles.homeStat} ${styles[metric.style]}`} href={metric.href} key={metric.title}>
            <span className={styles.homeStatIcon}><Icon name={metric.icon} size={30} /></span>
            <span className={styles.homeStatCopy}>
              <span>{metric.title}</span>
              <strong>{metric.amount}</strong>
            </span>
            <Icon name={metric.icon} size={82} className={styles.homeStatDecoration} />
          </Link>
        ))}
      </div>
    </section>
  );
}

export function TeaShopDashboard({ tiles, change, comparison }: { tiles: Tiles; change: string | number | null; comparison: string }) {
  const { t } = useT();
  const parsedTrend = change == null ? null : Number(change);
  const trend = parsedTrend !== null && Number.isFinite(parsedTrend) ? parsedTrend : null;
  const metrics: Metric[] = [
    { title: t('totalSales'), amount: formatINR(tiles.totalSales, { decimals: false }), icon: 'trend', tone: 'blue', href: '/pl', note: trend === null ? undefined : `${trend >= 0 ? '▲' : '▼'} ${Math.abs(trend)}% ${comparison}`, noteTone: trend === null ? undefined : trend >= 0 ? 'up' : 'down' },
    { title: t('expenses'), amount: formatINR(tiles.totalExpenses, { decimals: false }), icon: 'card', tone: 'yellow', href: '/expenses' },
    { title: t('net'), amount: formatINR(tiles.netOperating, { decimals: false }), icon: 'bars', tone: 'green', href: '/pl' },
    { title: t('purchases'), amount: formatINR(tiles.totalPurchases, { decimals: false }), icon: 'bag', mdi: mdiCartOutline, tone: 'purple', href: '/purchases' },
    { title: t('cash'), amount: formatINR(tiles.cash, { decimals: false }), icon: 'wallet', mdi: mdiPurseOutline, tone: 'green', href: '/cash' },
    { title: t('upi'), amount: formatINR(tiles.upi, { decimals: false }), icon: 'phone', mdi: mdiQrcodeScan, tone: 'cyan', href: '/cash' },
    { title: t('card'), amount: formatINR(tiles.card, { decimals: false }), icon: 'card', mdi: mdiCreditCardOutline, tone: 'blue', href: '/cash' },
    { title: t('wastage'), amount: formatINR(tiles.wastage, { decimals: false }), icon: 'trash', mdi: mdiDeleteOutline, tone: 'red', href: '/inventory' },
    { title: 'Profit/Loss', amount: formatINR(tiles.netOperating, { decimals: false }), icon: 'bars', mdi: mdiScaleBalance, tone: 'green', href: '/pl' },
    { title: 'Pending bills', amount: formatINR(tiles.supplierOutstanding, { decimals: false }), icon: 'clock', tone: 'yellow', href: '/purchases' },
  ];

  return (
    <section className={styles.dashboardContent} aria-label="Business summary">
      <h2 className={styles.allFiguresHeading}>{t('attAllFigures')}</h2>
      <div className={styles.metricsGrid}>
        {metrics.map(({ title, amount, icon, tone, href, mdi, note, noteTone }) => (
          <Link className={styles.metricCard} href={href} key={title} aria-label={`${title}: ${amount}`}>
            <span className={`${styles.metricIcon} ${styles[tone]}`}>
              {mdi ? <MdiIcon path={mdi} size={31} strokeWidth={2.1} /> : <Icon name={icon} size={31} />}
            </span>
            <span className={styles.metricCopy}>
              <span className={styles.metricTitle}>{title}</span>
              <strong className={styles.metricAmount}>{amount}</strong>
              {note && (
                <span className={styles.metricNote}>
                  <span className={noteTone === 'up' ? styles.metricNoteUp : styles.metricNoteDown}>{note.slice(0, 1)}</span>
                  {note.slice(1)}
                </span>
              )}
            </span>
            <Icon name="chevronRight" size={22} className={styles.metricChevron} />
          </Link>
        ))}
      </div>
      <div className={styles.goodFoodNote}>
        <span className={styles.goodFoodCopy}>Good Food<br />Good Mood</span>
        <MdiIcon path={mdiCoffee} size={34} />
      </div>
    </section>
  );
}
