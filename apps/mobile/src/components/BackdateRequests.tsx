import { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from './Text';
import { api, ApiError } from '@/lib/api';
import { prettyDate } from '@/lib/dates';
import { useTheme } from '@/lib/theme';
import { Button, Card, ErrorBox, Field, Muted, Sheet } from './ui';
import { savedEntry, startEntry, useEntryDay } from '@/lib/workDate';
import { useLive } from '@/lib/live';

interface Day { date: string; request: { id: string; status: 'PENDING' | 'APPROVED' | 'REJECTED'; reason: string; decisionNote?: string | null } | null }

/** Days that were not closed by the cut-off (23:30) are locked. Ask the Admin to open one; once approved the day can be entered. */
export function BackdateRequests({ locationId }: { locationId: string }) {
  const th = useTheme();
  const entry = useEntryDay();
  const [resume, setResume] = useState<string | null>(null);
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
  useLive(load, ['BACKDATE_REQUEST', 'DAILY_CLOSING']);
  // reload when a day is left (it may have been submitted); the day left half-way shows "Continue"
  useEffect(() => { if (!entry.date) { void load(); void savedEntry().then((s) => setResume(s?.date ?? null)); } }, [entry.date, load]);
  // the app was closed in the middle of a day: open it again where it stopped
  useEffect(() => {
    if (!days) return;
    void savedEntry().then((s) => { if (s?.open && !entry.date && days.some((d) => d.date === s.date && d.request?.status === 'APPROVED')) void startEntry(s.date); });
  }, [days]); // eslint-disable-line react-hooks/exhaustive-deps

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
      {days.map((d, i) => {
        const st = d.request?.status;
        // one fixed-size slot on the right, so the three states (request, waiting, approved) line up row after row
        const pill = (text: string, bg: string, fg: string, border: string) => (
          <View style={{ width: 172, height: 42, borderRadius: 12, borderWidth: 1, borderColor: border, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
            <Text numberOfLines={1} style={{ color: fg, fontWeight: '800', fontSize: 13 }}>{text}</Text>
          </View>
        );
        return (
          <View key={d.date} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingTop: i === 0 ? 4 : 10, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: th.warn.border }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: th.ink, fontWeight: '800', fontSize: 15 }}>{prettyDate(d.date)}</Text>
              {st === 'REJECTED' ? <Text numberOfLines={2} style={{ color: th.bad.text, fontSize: 12 }}>Rejected{d.request?.decisionNote ? `: ${d.request.decisionNote}` : ''}</Text> : null}
            </View>
            {!st || st === 'REJECTED' ? (
              <Pressable onPress={() => { setError(null); setReason(''); setAsking(d.date); }} accessibilityRole="button" accessibilityLabel={`Request entry for ${prettyDate(d.date)}`}>
                {pill('Request entry', th.surface, th.ink, th.border)}
              </Pressable>
            ) : st === 'PENDING' ? pill('◔  Waiting for approval', th.warn.bg, th.warn.text, '#F59E0B') : (
              <Pressable onPress={() => void startEntry(d.date)} accessibilityRole="button" accessibilityLabel={`Enter ${prettyDate(d.date)}`}>
                {pill(resume === d.date ? 'Continue entry  →' : '✓  Enter this day  →', th.ok.bg, th.ok.text, th.ok.border)}
              </Pressable>
            )}
          </View>
        );
      })}
      <Sheet open={!!asking} onClose={() => setAsking(null)} title={`Request entry · ${asking ? prettyDate(asking) : ''}`}>
        <Field label="Reason" required value={reason} onChangeText={setReason} multiline placeholder="Why was the day not closed?" />
        <ErrorBox error={error} />
        <Button title="Send request" onPress={send} loading={busy} disabled={reason.trim().length < 3} />
      </Sheet>
    </Card>
  );
}
