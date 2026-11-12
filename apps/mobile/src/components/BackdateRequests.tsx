import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Text } from './Text';
import { api, ApiError } from '@/lib/api';
import { prettyDate } from '@/lib/dates';
import { useTheme } from '@/lib/theme';
import { Button, Card, Chip, ErrorBox, Field, Muted, Sheet } from './ui';

interface Day { date: string; request: { id: string; status: 'PENDING' | 'APPROVED' | 'REJECTED'; reason: string; decisionNote?: string | null } | null }

/** Days that were not closed by the cut-off (23:30) are locked. Ask the Admin to open one; once approved the day can be entered. */
export function BackdateRequests({ locationId }: { locationId: string }) {
  const th = useTheme();
  const [days, setDays] = useState<Day[] | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!locationId) return;
    try { setDays(await api.get<Day[]>(`/backdate-requests/eligible?locationId=${locationId}`)); } catch { setDays([]); }
  }, [locationId]);
  useEffect(() => { void load(); }, [load]);

  async function send() {
    if (!asking) return;
    setBusy(true); setError(null);
    try { await api.post('/backdate-requests', { locationId, businessDate: asking, reason: reason.trim() }); setAsking(null); setReason(''); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Could not send'); }
    finally { setBusy(false); }
  }

  if (!days || days.length === 0) return null;
  return (
    <Card tone="warn" style={{ gap: 10 }}>
      <Text style={{ color: th.warn.text, fontWeight: '800', fontSize: 16 }}>Days not closed on time</Text>
      <Muted small>The closing time has passed, so these days are locked. Ask your Admin to open one so you can enter it.</Muted>
      {days.map((d) => (
        <View key={d.date} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 44 }}>
          <Text style={{ color: th.ink, fontWeight: '700' }}>{prettyDate(d.date)}</Text>
          {!d.request || d.request.status === 'REJECTED' ? (
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              {d.request?.status === 'REJECTED' ? <Text style={{ color: th.bad.text, fontSize: 12 }}>Rejected{d.request.decisionNote ? `: ${d.request.decisionNote}` : ''}</Text> : null}
              <Button small variant="secondary" title="Request entry" onPress={() => { setError(null); setReason(''); setAsking(d.date); }} />
            </View>
          ) : d.request.status === 'PENDING' ? <Chip text="Waiting for approval" tone="warn" icon="◔" /> : <Chip text="Approved - enter it now" tone="ok" icon="✓" />}
        </View>
      ))}
      <Sheet open={!!asking} onClose={() => setAsking(null)} title={`Request entry · ${asking ? prettyDate(asking) : ''}`}>
        <Field label="Reason" required value={reason} onChangeText={setReason} multiline placeholder="Why was the day not closed?" />
        <ErrorBox error={error} />
        <Button title="Send request" onPress={send} loading={busy} disabled={reason.trim().length < 3} />
      </Sheet>
    </Card>
  );
}
