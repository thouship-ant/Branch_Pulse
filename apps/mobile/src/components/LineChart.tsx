import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '@/components/Text';
import { useTheme } from '@/lib/theme';

export interface LineSeries { name: string; color: string; values: Array<number | null> }

const AXIS_W = 46;
const PAD_T = 12;
const LABEL_H = 22;
const AREA_STEP = 3;

/** 0, step, 2*step ... with a "round" step (1, 2, 2.5, 5, 10 x a power of ten) so the axis reads cleanly. */
function niceMax(raw: number) {
  const s = (raw > 0 ? raw : 1) / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(s)));
  const norm = s / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  return step * 4;
}

export const axisMoney = (n: number) => (n >= 10_000_000 ? `₹${+(n / 10_000_000).toFixed(1)}Cr` : n >= 100_000 ? `₹${+(n / 100_000).toFixed(1)}L` : n >= 1000 ? `₹${+(n / 1000).toFixed(1)}K` : `₹${+n.toFixed(1)}`);

/**
 * A line chart with a soft filled area, drawn with plain views (no graphics library needed, so it works on the phone and the web).
 * Tap or drag across it to pick a day: `onSelect` gets the index. `bubble` shows the value above the picked point.
 */
export function LineChart({ labels, series, height = 170, hideAmounts = false, fmtAxis = axisMoney, fmtBubble, selected, onSelect, bubble = false }: {
  labels: string[]; series: LineSeries[]; height?: number; hideAmounts?: boolean; fmtAxis?: (n: number) => string; fmtBubble?: (n: number) => string;
  selected: number | null; onSelect: (i: number) => void; bubble?: boolean;
}) {
  const th = useTheme();
  const [w, setW] = useState(0);
  const n = labels.length;
  const plotW = Math.max(0, w - AXIS_W - 8);
  const plotH = height - PAD_T - LABEL_H;
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values.map((v) => v ?? 0))));
  const xOf = (i: number) => AXIS_W + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
  const yOf = (v: number) => PAD_T + plotH * (1 - v / max);
  const pick = (x: number) => { if (n > 0 && plotW > 0) onSelect(Math.max(0, Math.min(n - 1, Math.round(((x - AXIS_W) / plotW) * (n - 1))))); };
  const tickIdx = n <= 1 ? [0] : [0, 1, 2, 3, 4].map((k) => Math.round((k / 4) * (n - 1))).filter((v, k, a) => a.indexOf(v) === k);

  return (
    <View style={{ height }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {w > 0 ? (
        <>
          {[0, 1, 2, 3, 4].map((t) => {
            const y = yOf((max / 4) * t);
            return (
              <View key={t} pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: y - 8, height: 16, justifyContent: 'center' }}>
                <Text numberOfLines={1} style={{ width: AXIS_W - 6, textAlign: 'right', color: th.muted, fontSize: 10 }}>{hideAmounts ? '••' : fmtAxis((max / 4) * t)}</Text>
                <View style={{ position: 'absolute', left: AXIS_W, width: plotW, height: 1, backgroundColor: th.border, opacity: t === 0 ? 1 : 0.7 }} />
              </View>
            );
          })}

          {series.map((s) => {
            const pts = s.values.map((v, i) => (v === null ? null : { x: xOf(i), y: yOf(v), i })).filter((p): p is { x: number; y: number; i: number } => !!p);
            const segs = pts.slice(1).map((b, k) => ({ a: pts[k], b }));
            return (
              <View key={s.name} pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: w, height }}>
                {/* soft area under the line: thin vertical strips */}
                {segs.flatMap(({ a, b }) => {
                  const from = Math.ceil(a.x / AREA_STEP) * AREA_STEP;
                  const out = [];
                  for (let x = from; x < b.x; x += AREA_STEP) {
                    const y = a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x || 1);
                    out.push(<View key={`${a.i}-${x}`} style={{ position: 'absolute', left: x, width: AREA_STEP, top: y, height: PAD_T + plotH - y, backgroundColor: s.color, opacity: 0.14 }} />);
                  }
                  return out;
                })}
                {segs.map(({ a, b }) => {
                  const len = Math.hypot(b.x - a.x, b.y - a.y);
                  const ang = Math.atan2(b.y - a.y, b.x - a.x);
                  return <View key={a.i} style={{ position: 'absolute', left: (a.x + b.x) / 2 - len / 2, top: (a.y + b.y) / 2 - 1.25, width: len, height: 2.5, borderRadius: 2, backgroundColor: s.color, transform: [{ rotate: `${ang}rad` }] }} />;
                })}
              </View>
            );
          })}

          {selected !== null && selected < n ? (
            <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: w, height }}>
              <View style={{ position: 'absolute', left: xOf(selected), top: PAD_T, width: 1, height: plotH, backgroundColor: th.muted, opacity: 0.45 }} />
              {series.map((s) => {
                const v = s.values[selected];
                if (v === null || v === undefined) return null;
                return (
                  <View key={s.name}>
                    <View style={{ position: 'absolute', left: xOf(selected) - 5, top: yOf(v) - 5, width: 10, height: 10, borderRadius: 5, backgroundColor: '#fff', borderWidth: 2, borderColor: s.color }} />
                    {bubble ? (
                      <View style={{ position: 'absolute', left: Math.max(AXIS_W, Math.min(w - 64, xOf(selected) - 28)), top: Math.max(0, yOf(v) - 32), minWidth: 56, paddingHorizontal: 8, height: 24, borderRadius: 8, backgroundColor: '#14532d', alignItems: 'center', justifyContent: 'center' }}>
                        <Text numberOfLines={1} style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>{hideAmounts ? '••••' : (fmtBubble ?? axisMoney)(v)}</Text>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          ) : null}

          {tickIdx.map((i) => (
            <Text key={i} numberOfLines={1} style={{ position: 'absolute', top: height - LABEL_H + 6, left: Math.max(AXIS_W - 6, Math.min(w - 52, xOf(i) - 26)), width: 52, textAlign: i === 0 ? 'left' : i === n - 1 ? 'right' : 'center', color: th.muted, fontSize: 10 }}>{labels[i]}</Text>
          ))}

          <Pressable
            accessibilityRole="adjustable" accessibilityLabel="Chart: tap or drag to pick a day"
            onPress={(e) => pick(e.nativeEvent.locationX)}
            onTouchMove={(e) => pick(e.nativeEvent.locationX)}
            style={{ position: 'absolute', left: 0, top: 0, width: w, height }}
          />
        </>
      ) : null}
    </View>
  );
}
