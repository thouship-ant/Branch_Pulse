'use client';

import { useState } from 'react';
import { AdvanceManager } from '@/components/employees/AdvanceManager';
import { AttendanceRoster } from '@/components/employees/AttendanceRoster';
import { EmployeeManager } from '@/components/employees/EmployeeManager';
import { useT } from '@/lib/i18n';
import { useBranch } from '@/lib/useBranch';

type Tab = 'attendance' | 'advances' | 'team';

/** Branch manager: mark today's attendance, request/approve staff advances, and see the branch's team. */
export default function BranchStaffPage() {
  const { t } = useT();
  const { locationId } = useBranch();
  const [tab, setTab] = useState<Tab>('attendance');
  const tabs: Array<[Tab, string]> = [['attendance', t('tabAttendance')], ['advances', t('tabAdvances')], ['team', t('tabEmployees')]];
  if (!locationId) return null;

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">{t('employeesTitle')}</h2>
      <div className="flex w-full gap-1 overflow-x-auto" role="tablist">
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className="shrink-0">{label}</button>
        ))}
      </div>
      {tab === 'attendance' && <AttendanceRoster locations={[]} fixedLocationId={locationId} />}
      {tab === 'advances' && <AdvanceManager locations={[]} fixedLocationId={locationId} />}
      {tab === 'team' && <EmployeeManager locations={[]} fixedLocationId={locationId} />}
    </div>
  );
}
