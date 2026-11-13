import { useState } from 'react';
import { EmployeeOverview } from '@/components/EmployeeOverview';
import { AdvancesPanel, AttendancePanel, EmployeeList, SalaryPanel } from '@/components/Employees';
import { Screen, SegTabs } from '@/components/ui';
import { useSession } from '@/lib/session';

type Tab = 'overview' | 'staff' | 'attendance' | 'salary' | 'advances';

/** Employee records, daily attendance, monthly payroll and the advance workflow. */
export default function EmployeesScreen() {
  const { can } = useSession();
  const [tab, setTab] = useState<Tab>('overview');
  const tabs: Array<{ key: Tab; label: string }> = [{ key: 'overview', label: 'Overview' }, { key: 'staff', label: 'Staff' }];
  if (can('attendance:view')) tabs.push({ key: 'attendance', label: 'Attendance' });
  if (can('salary:manage')) tabs.push({ key: 'salary', label: 'Salary' });
  if (can('advance:view')) tabs.push({ key: 'advances', label: 'Advances' });
  return (
    <Screen title="Employees" top={<SegTabs value={tab} onChange={setTab} tabs={tabs} />}>
      {tab === 'overview' ? <EmployeeOverview /> : tab === 'staff' ? <EmployeeList /> : tab === 'attendance' ? <AttendancePanel /> : tab === 'salary' ? <SalaryPanel /> : <AdvancesPanel />}
    </Screen>
  );
}
