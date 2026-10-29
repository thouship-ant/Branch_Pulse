import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { BranchForm } from '@/components/BranchForm';
import { Button, Chip, Chips, Empty, ErrorBox, ListRow, Loading, Screen, Sheet, ToggleRow } from '@/components/ui';
import { api } from '@/lib/api';
import { formatINR } from '@/lib/money';

type Filter = 'ALL' | 'BRANCH' | 'GODOWN' | 'CENTRAL_OFFICE';
const TYPE_LABEL: Record<string, string> = { BRANCH: 'Branch', GODOWN: 'Godown', CENTRAL_OFFICE: 'Office' };

/** Branches, godowns and offices: add, open, filter. */
export default function BranchesScreen() {
  const router = useRouter();
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [showInactive, setShowInactive] = useState(true);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try { setRows(await api.get('/locations')); setError(null); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const visible = (rows ?? []).filter((r) => (filter === 'ALL' || r.type === filter) && (showInactive || r.status === 'ACTIVE'));
  return (
    <Screen title="Branches" onRefresh={load} headerRight={<Button small variant="secondary" icon="plus" title="Add" onPress={() => setAdding(true)} />}>
      <Chips label="Type" value={filter} onChange={setFilter} options={[{ value: 'ALL', label: 'All' }, { value: 'BRANCH', label: 'Branch' }, { value: 'GODOWN', label: 'Godown' }, { value: 'CENTRAL_OFFICE', label: 'Office' }]} />
      <ToggleRow label="Show inactive" value={showInactive} onChange={setShowInactive} />
      <ErrorBox error={error} />
      {!rows ? <Loading /> : visible.length === 0 ? <Empty text="No branches yet." /> : visible.map((b) => (
        <ListRow
          key={b.id} title={b.name}
          lines={[`${b.code} · ${TYPE_LABEL[b.type] ?? b.type}`, b.type === 'BRANCH' ? `Manager: ${b.manager ? b.manager.fullName : 'not assigned'}` : null, b.type === 'BRANCH' ? `Opening cash ${formatINR(b.defaultOpeningCash, { decimals: false })}` : null]}
          right={<View><Chip text={b.status === 'ACTIVE' ? 'Active' : 'Inactive'} tone={b.status === 'ACTIVE' ? 'ok' : 'neutral'} icon={b.status === 'ACTIVE' ? '●' : '○'} /></View>}
          onPress={() => router.push(`/more/branch/${b.id}` as any)}
        />
      ))}
      <Sheet open={adding} onClose={() => setAdding(false)} title="Add branch">
        <BranchForm onDone={() => { setAdding(false); void load(); }} />
      </Sheet>
    </Screen>
  );
}
