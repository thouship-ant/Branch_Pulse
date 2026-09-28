'use client';

import { useState } from 'react';
import { ApprovalLimits } from '@/components/settings/ApprovalLimits';
import { GeneralSettings } from '@/components/settings/GeneralSettings';
import { RolesManager } from '@/components/settings/RolesManager';
import { UnitsManager } from '@/components/settings/UnitsManager';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';

type Tab = 'general' | 'limits' | 'roles' | 'units';

/** Owner: business-wide rules, approval limits, role permissions and units of measure (LLD s31 settings). */
export default function SettingsPage() {
  const { t } = useT();
  const { can } = useSession();
  const [tab, setTab] = useState<Tab>('general');
  if (!can('settings:manage')) return <p className="card">{t('noAccess')}</p>;

  const tabs: Array<[Tab, string]> = [['general', t('tabGeneral')], ['limits', t('tabApprovalLimits')]];
  if (can('role:manage')) tabs.push(['roles', t('tabRoles')]);
  if (can('item:manage')) tabs.push(['units', t('tabUnits')]);

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">{t('settingsTitle')}</h2>
      <div className="flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist">
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`min-h-touch whitespace-nowrap border-b-2 px-4 text-sm font-semibold ${tab === k ? 'border-brand text-brand' : 'border-transparent text-slate-600 hover:text-ink'}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'general' && <GeneralSettings />}
      {tab === 'limits' && <ApprovalLimits />}
      {tab === 'roles' && can('role:manage') && <RolesManager />}
      {tab === 'units' && can('item:manage') && <UnitsManager />}
    </div>
  );
}
