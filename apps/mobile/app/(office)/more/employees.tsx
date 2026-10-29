import { useState } from 'react';
import { AdvancesPanel, AttendancePanel, EmployeeList, SalaryPanel } from '@/components/Employees';
import { Screen, SegTabs } from '@/components/ui';
import { useSession } from '@/lib/session';

type Tab = 'staff' | 'attendance' | 'salary' | 'advances';

/** Employee records, daily attendance, monthly payroll and the advance workflow. */
export default function EmployeesScreen() {
  const { can } = useSession();
  const [tab, setTab] = useState<Tab>('staff');
  const tabs: Array<{ key: Tab; label: string }> = [{ key: 'staff', label: 'Staff' }];
  if (can('attendance:view')) tabs.push({ key: 'attendance', label: 'Attendance' });
  if (can('salary:manage')) tabs.push({ key: 'salary', label: 'Salary' });
  if (can('advance:view')) tabs.push({ key: 'advances', label: 'Advances' });
  return (
    <Screen title="Employees">
      <SegTabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'staff' ? <EmployeeList /> : tab === 'attendance' ? <AttendancePanel /> : tab === 'salary' ? <SalaryPanel /> : <AdvancesPanel />}
    </Screen>
  );
}
