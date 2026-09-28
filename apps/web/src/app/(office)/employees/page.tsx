'use client';

import { useEffect, useState } from 'react';
import { AdvanceManager } from '@/components/employees/AdvanceManager';
import { AttendanceRoster } from '@/components/employees/AttendanceRoster';
import { EmployeeManager } from '@/components/employees/EmployeeManager';
import { SalaryManager } from '@/components/employees/SalaryManager';
import type { LocationOption } from '@/components/purchases/PurchaseForm';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';

type Tab = 'employees' | 'attendance' | 'salary' | 'advances';

/** Owner / accountant: employee records, daily attendance, monthly payroll and the advance workflow. */
export default function EmployeesPage() {
  const { t } = useT();
  const { can } = useSession();
  const [tab, setTab] = useState<Tab>('employees');
  const [locations, setLocations] = useState<LocationOption[]>([]);
  useEffect(() => { api.get('/locations').then((l) => setLocations((l as LocationOption[]).filter((x) => x.type === 'BRANCH'))).catch(() => undefined); }, []);
  if (!can('staff:view')) return <p className="card">{t('noAccess')}</p>;

  const tabs: Array<[Tab, string]> = [['employees', t('tabEmployees')]];
  if (can('attendance:view')) tabs.push(['attendance', t('tabAttendance')]);
  if (can('salary:manage')) tabs.push(['salary', t('tabSalary')]);
  if (can('advance:view')) tabs.push(['advances', t('tabAdvances')]);

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">{t('employeesTitle')}</h2>
      <div className="flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist">
        {tabs.map(([k, label]) => (
          <button
            key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`min-h-touch whitespace-nowrap border-b-2 px-4 text-sm font-semibold ${tab === k ? 'border-brand text-brand' : 'border-transparent text-slate-600 hover:text-ink'}`}
          >{label}</button>
        ))}
      </div>
      {tab === 'employees' && <EmployeeManager locations={locations} />}
      {tab === 'attendance' && <AttendanceRoster locations={locations} />}
      {tab === 'salary' && <SalaryManager locations={locations} />}
      {tab === 'advances' && <AdvanceManager locations={locations} />}
    </div>
  );
}
