import { useState } from 'react';
import { AdvancesPanel, AttendancePanel, EmployeeList } from '@/components/Employees';
import { Loading, Screen, SegTabs } from '@/components/ui';
import { useBranch } from '@/lib/session';

type Tab = 'attendance' | 'advances' | 'team';

/** Branch manager: mark today's attendance, request / approve staff advances, see the branch team. */
export default function BranchStaffScreen() {
  const { locationId } = useBranch();
  const [tab, setTab] = useState<Tab>('attendance');
  if (!locationId) return <Screen><Loading /></Screen>;
  return (
    <Screen>
      <SegTabs value={tab} onChange={setTab} tabs={[{ key: 'attendance', label: 'Attendance' }, { key: 'advances', label: 'Advances' }, { key: 'team', label: 'Team' }]} />
      {tab === 'attendance' ? <AttendancePanel fixedLocationId={locationId} /> : tab === 'advances' ? <AdvancesPanel fixedLocationId={locationId} /> : <EmployeeList fixedLocationId={locationId} />}
    </Screen>
  );
}
