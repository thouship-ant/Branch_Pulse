'use client';

import { Select } from '@/components/Select';
import { useEffect, useState } from 'react';
import { PLReport, type PLLines } from '@/components/pl/PLReport';
import { PeriodPicker, usePeriod } from '@/components/PeriodPicker';
import type { LocationOption } from '@/components/purchases/PurchaseForm';
import { ErrorBox, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { prettyDate } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';

type Tab = 'branch' | 'consolidated';
const PRESETS: Array<'today' | '7' | 'month' | 'year'> = ['today', '7', 'month', 'year'];

function BranchPL({ locations }: { locations: LocationOption[] }) {
  const { t, pick } = useT();
  const period = usePeriod('month');
  const { range, valid } = period;
  const [locationId, setLocationId] = useState('');
  const [data, setData] = useState<PLLines | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!locationId || !valid) { setData(null); return; }
    api.get(`/pl/branch?locationId=${locationId}&from=${range.from}&to=${range.to}`).then(setData).catch((e) => setError(e.message));
  }, [locationId, range.from, range.to, valid]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px]">
          <label htmlFor="plb" className="label">{t('branch')}</label>
          <Select id="plb" className="field" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">{t('chooseLocation')}</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.code} · {pick(l.name, l.nameTa)}</option>)}
          </Select>
        </div>
        <PeriodPicker period={period} label={t('plTitle')} presets={PRESETS} />
      </div>
      <ErrorBox error={error} />
      {!locationId ? <p className="card text-slate-600">{t('chooseBranchFirst')}</p> : !data ? <Skeleton className="h-64" /> : (
        <PLReport data={data} subtitle={`${prettyDate(data.from)} – ${prettyDate(data.to)}`} />
      )}
    </div>
  );
}

function ConsolidatedPL() {
  const { t } = useT();
  const period = usePeriod('month');
  const { range, valid } = period;
  const [data, setData] = useState<(PLLines & { branchCount: number }) | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!valid) return;
    api.get(`/pl/consolidated?from=${range.from}&to=${range.to}`).then(setData).catch((e) => setError(e.message));
  }, [range.from, range.to, valid]);

  return (
    <div className="space-y-4">
      <PeriodPicker period={period} label={t('consolidatedPLTitle')} presets={PRESETS} />
      <ErrorBox error={error} />
      {!data ? <Skeleton className="h-64" /> : (
        <>
          <p className="text-sm text-slate-500">{data.branchCount} {t('branchesLabel').toLowerCase()}</p>
          <PLReport data={data} subtitle={`${prettyDate(data.from)} – ${prettyDate(data.to)}`} />
        </>
      )}
    </div>
  );
}

/** Owner / accountant: the branch P&L and the whole-business roll-up, for a chosen date range. Management accounting only. */
export default function PLPage() {
  const { t } = useT();
  const { can } = useSession();
  const [tab, setTab] = useState<Tab>('branch');
  const [locations, setLocations] = useState<LocationOption[]>([]);
  useEffect(() => { api.get('/locations').then((l) => setLocations((l as LocationOption[]).filter((x) => x.type === 'BRANCH'))).catch(() => undefined); }, []);
  if (!can('pl:view')) return <p className="card">{t('noAccess')}</p>;

  const tabs: Array<[Tab, string]> = [['branch', t('tabBranchPL')], ['consolidated', t('tabConsolidatedPL')]];

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">{t('plTitle')}</h2>
      <div className="flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist">
        {tabs.map(([k, label]) => (
          <button
            key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`min-h-touch whitespace-nowrap border-b-2 px-4 text-sm font-semibold ${tab === k ? 'border-brand text-brand' : 'border-transparent text-slate-600 hover:text-ink'}`}
          >{label}</button>
        ))}
      </div>
      {tab === 'branch' && <BranchPL locations={locations} />}
      {tab === 'consolidated' && <ConsolidatedPL />}
    </div>
  );
}
