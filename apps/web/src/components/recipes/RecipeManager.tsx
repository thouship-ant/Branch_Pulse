'use client';

import { Select } from '@/components/Select';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { prettyDate, shortDate } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { cleanAmount, dec, formatINR } from '@/lib/money';
import { useSession } from '@/lib/session';
import { ChartCard, compact, LineChart } from '../charts';
import { PeriodPicker, usePeriod } from '../PeriodPicker';
import { ActiveChip, ErrorBox, Sheet, Skeleton, TextField } from '../ui';

interface Unit { id: string; code: string; baseUnitId: string | null }
interface Item { id: string; nameEn: string; nameTa?: string | null; baseUnitId: string; status: string }
interface Boot { units: Unit[]; items: Item[] }
interface Line { key: number; itemId: string; unitId: string; qty: string }
interface Draft { id?: string; nameEn: string; nameTa: string; yieldQty: string; sellingPrice: string; active: boolean; lines: Line[] }

let lineKey = 1;
const blankLine = (): Line => ({ key: lineKey++, itemId: '', unitId: '', qty: '' });

/** Cost breakdown, margin and cost-over-time for one recipe: management accounting, never a bill. */
function RecipeDetail({ recipe }: { recipe: any }) {
  const { t, pick } = useT();
  const period = usePeriod('90');
  const { range, valid } = period;
  const [trend, setTrend] = useState<any>(null);

  useEffect(() => {
    if (!valid) return;
    api.get(`/recipes/${recipe.id}/cost-trend?from=${range.from}&to=${range.to}`).then(setTrend).catch(() => undefined);
  }, [recipe.id, range.from, range.to, valid]);

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="card"><p className="text-sm text-slate-600">{t('estimatedCostLabel')}</p><p className="text-xl font-bold tabular-nums">{formatINR(recipe.costPerUnit)}</p></div>
        <div className="card"><p className="text-sm text-slate-600">{t('sellingPriceLabel')}</p><p className="text-xl font-bold tabular-nums">{recipe.sellingPrice ? formatINR(recipe.sellingPrice) : '—'}</p></div>
        <div className="card"><p className="text-sm text-slate-600">{t('grossMarginLabel')}</p><p className="text-xl font-bold tabular-nums">{recipe.marginPct !== null ? `${recipe.marginPct}%` : '—'}</p>{recipe.marginPct === null && <p className="text-xs text-slate-500">{t('noMargin')}</p>}</div>
        <div className="card"><p className="text-sm text-slate-600">{t('yieldQtyLabel')}</p><p className="text-xl font-bold tabular-nums">{dec(recipe.yieldQty).toString()}</p></div>
      </section>

      <section className="card overflow-x-auto p-0" aria-label={t('ingredientsLabel')}>
        <table className="w-full min-w-[480px] text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th scope="col" className="px-3 py-2 text-left">{t('ingredientLabel')}</th>
              <th scope="col" className="px-3 py-2 text-right">{t('quantity')}</th>
              <th scope="col" className="px-3 py-2 text-right">{t('unitCostLabel')}</th>
              <th scope="col" className="px-3 py-2 text-right">{t('lineCostLabel')}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {recipe.breakdown.map((b: any) => (
              <tr key={b.itemId}>
                <td className="px-3 py-2">{pick(b.name, b.nameTa)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{dec(b.quantity).toString()} {b.unitCode}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatINR(b.unitCost)}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatINR(b.lineCost)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t font-semibold">
              <td className="px-3 py-2" colSpan={3}>{t('estimatedCostLabel')}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatINR(recipe.totalCost)}</td>
            </tr>
          </tfoot>
        </table>
      </section>

      <PeriodPicker period={period} label={t('costTrendTitle')} />
      <ChartCard
        title={t('costTrendTitle')} empty={!trend || trend.points.length === 0} emptyText={t('noData')}
        subtitle={trend?.change ? `${t('costChangeLabel')}: ${trend.change.changePct}%` : undefined}
        table={trend ? { head: [t('dateLabel'), t('estimatedCostLabel')], rows: trend.points.map((p: any) => [prettyDate(p.date), formatINR(p.costPerUnit)]) } : undefined}
      >
        {trend && trend.points.length > 0 && (
          <LineChart
            ariaLabel={t('costTrendTitle')} labels={trend.points.map((p: any) => p.date)}
            series={[{ key: 'cost', name: t('estimatedCostLabel'), color: 'var(--series-1)', values: trend.points.map((p: any) => Number(p.costPerUnit)) }]}
            fmt={(n) => formatINR(n)} axisFmt={(n) => compact(n, true)} xText={(d) => shortDate(d)} tipTitle={(d) => prettyDate(d)}
          />
        )}
      </ChartCard>
    </div>
  );
}

/** The owner's recipe list: define ingredients, see the estimated cost and margin, and how cost has moved over time. Never a bill. */
export function RecipeManager() {
  const { t, pick } = useT();
  const { can } = useSession();
  const [recipes, setRecipes] = useState<any[] | null>(null);
  const [boot, setBoot] = useState<Boot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<any | null>(null);

  const load = useCallback(async () => {
    try { setRecipes(await api.get('/recipes?includeInactive=true')); setError(null); } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { void load(); api.get('/sync/bootstrap').then((b) => setBoot({ units: b.units, items: b.items })).catch(() => undefined); }, [load]);

  const items = boot?.items.filter((i) => i.status === 'ACTIVE') ?? [];
  const unitsFor = (itemId: string) => {
    const item = items.find((i) => i.id === itemId);
    return item ? (boot?.units ?? []).filter((u) => u.id === item.baseUnitId || u.baseUnitId === item.baseUnitId) : [];
  };

  const blank = (): Draft => ({ nameEn: '', nameTa: '', yieldQty: '1', sellingPrice: '', active: true, lines: [blankLine()] });
  const fromRecipe = (r: any): Draft => ({
    id: r.id, nameEn: r.nameEn, nameTa: r.nameTa ?? '', yieldQty: String(r.yieldQty), sellingPrice: r.sellingPrice ? String(r.sellingPrice) : '', active: r.status === 'ACTIVE',
    lines: (r.items as any[]).map((i) => ({ key: lineKey++, itemId: i.itemId, unitId: i.unitId, qty: String(i.quantity) })),
  });

  function setLine(key: number, patch: Partial<Line>) { setDraft((d) => (d ? { ...d, lines: d.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) } : d)); }
  function chooseItem(key: number, itemId: string) {
    const item = items.find((i) => i.id === itemId);
    setLine(key, { itemId, unitId: item?.baseUnitId ?? '' });
  }

  const validLines = draft ? draft.lines.filter((l) => l.itemId && l.unitId && dec(l.qty).greaterThan(0)) : [];

  async function save() {
    if (!draft) return;
    setBusy(true); setFormError(null);
    try {
      const body: Record<string, unknown> = {
        nameEn: draft.nameEn.trim(), nameTa: draft.nameTa.trim() || undefined, yieldQty: dec(draft.yieldQty || '1').toString(),
        sellingPrice: draft.sellingPrice ? dec(draft.sellingPrice).toFixed(2) : draft.id ? null : undefined,
        items: validLines.map((l) => ({ itemId: l.itemId, unitId: l.unitId, quantity: dec(l.qty).toString() })),
      };
      if (draft.id) await api.patch(`/recipes/${draft.id}`, { ...body, active: draft.active });
      else await api.post('/recipes', body);
      setDraft(null); await load();
    } catch (e) {
      setFormError(e instanceof ApiError ? (Array.isArray(e.details) ? e.details.map((d: any) => d.message).join('; ') : e.message) : 'Could not save');
    } finally { setBusy(false); }
  }

  async function view(r: any) {
    setError(null);
    try { setViewing(await api.get(`/recipes/${r.id}`)); } catch (e: any) { setError(e.message); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">{t('notBillingHint')}</p>
        {can('recipe:manage') && <button className="btn-primary" onClick={() => { setFormError(null); setDraft(blank()); }}>+ {t('addRecipe')}</button>}
      </div>
      <ErrorBox error={error} />

      {!recipes ? <Skeleton className="h-48" /> : recipes.length === 0 ? <p className="card text-slate-600">{t('noRecipes')}</p> : (
        <section className="card overflow-x-auto p-0" aria-label={t('recipesTitle')}>
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th scope="col" className="px-3 py-2 text-left">{t('recipesTitle')}</th>
                <th scope="col" className="px-3 py-2 text-right">{t('estimatedCostLabel')}</th>
                <th scope="col" className="px-3 py-2 text-right">{t('sellingPriceLabel')}</th>
                <th scope="col" className="px-3 py-2 text-right">{t('grossMarginLabel')}</th>
                <th scope="col" className="px-3 py-2 text-left">{t('status')}</th>
                <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {recipes.map((r) => (
                <tr key={r.id} className={r.status !== 'ACTIVE' ? 'text-slate-500' : ''}>
                  <th scope="row" className="px-3 py-2 text-left font-medium">
                    <button className="hover:underline" onClick={() => view(r)}>{pick(r.nameEn, r.nameTa)}</button>
                    <p className="font-mono text-xs font-normal text-slate-500">{r.code} · {r.ingredientCount} {t('ingredientsLabel').toLowerCase()}</p>
                  </th>
                  <td className="px-3 py-2 text-right tabular-nums">{formatINR(r.costPerUnit)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.sellingPrice ? formatINR(r.sellingPrice) : '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.marginPct !== null ? `${r.marginPct}%` : '—'}</td>
                  <td className="px-3 py-2"><ActiveChip active={r.status === 'ACTIVE'} /></td>
                  <td className="px-3 py-2 text-right">{can('recipe:manage') && <button className="btn-secondary min-h-[34px] px-3 text-xs" onClick={() => { setFormError(null); setDraft(fromRecipe(r)); }}>{t('edit')}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <Sheet open={!!draft} onClose={() => setDraft(null)} title={draft ? (draft.id ? t('editRecipe') : t('addRecipe')) : ''}>
        {draft && boot && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField id="rn" label={`${t('recipeNameLabel')} *`} value={draft.nameEn} onChange={(e) => setDraft({ ...draft, nameEn: e.target.value })} maxLength={80} />
              <TextField id="rnt" label={t('catNameTa')} value={draft.nameTa} onChange={(e) => setDraft({ ...draft, nameTa: e.target.value })} maxLength={80} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label htmlFor="ry" className="label">{t('yieldQtyLabel')}</label><input id="ry" className="field text-lg tabular-nums" inputMode="decimal" value={draft.yieldQty} onChange={(e) => setDraft({ ...draft, yieldQty: cleanAmount(e.target.value, 3) })} /></div>
              <div><label htmlFor="rs" className="label">{t('sellingPriceLabel')}</label><input id="rs" className="field text-lg tabular-nums" inputMode="decimal" placeholder="0" value={draft.sellingPrice} onChange={(e) => setDraft({ ...draft, sellingPrice: cleanAmount(e.target.value, 2) })} /></div>
            </div>
            <section className="space-y-2">
              <h3 className="font-semibold">{t('ingredientsLabel')}</h3>
              {draft.lines.map((l, i) => {
                const opts = unitsFor(l.itemId);
                return (
                  <div key={l.key} className="flex items-end gap-2 rounded-card border border-slate-200 p-2.5">
                    <div className="min-w-0 flex-1">
                      <label htmlFor={`ri${l.key}`} className="label">{t('ingredientLabel')}</label>
                      <Select id={`ri${l.key}`} className="field" value={l.itemId} onChange={(e) => chooseItem(l.key, e.target.value)}>
                        <option value="">{t('chooseItem')}</option>
                        {items.map((x) => <option key={x.id} value={x.id}>{pick(x.nameEn, x.nameTa)}</option>)}
                      </Select>
                    </div>
                    <div className="w-24">
                      <label htmlFor={`rq${l.key}`} className="label">{t('quantity')}</label>
                      <input id={`rq${l.key}`} className="field text-right tabular-nums" inputMode="decimal" value={l.qty} onChange={(e) => setLine(l.key, { qty: cleanAmount(e.target.value, 3) })} />
                    </div>
                    <div className="w-20">
                      <label htmlFor={`ru${l.key}`} className="label">{t('unitLabel')}</label>
                      <Select id={`ru${l.key}`} className="field" value={l.unitId} disabled={!l.itemId} onChange={(e) => setLine(l.key, { unitId: e.target.value })}>
                        {opts.map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}
                      </Select>
                    </div>
                    {draft.lines.length > 1 && (
                      <button type="button" className="btn-secondary min-h-touch px-3" onClick={() => setDraft({ ...draft, lines: draft.lines.filter((x) => x.key !== l.key) })} aria-label={`${t('removeIngredient')} ${i + 1}`}>✕</button>
                    )}
                  </div>
                );
              })}
              <button type="button" className="btn-secondary min-h-touch" onClick={() => setDraft({ ...draft, lines: [...draft.lines, blankLine()] })}>+ {t('addIngredient')}</button>
            </section>
            {draft.id && (
              <label className="flex min-h-touch items-center gap-3 px-1">
                <input type="checkbox" className="h-5 w-5 accent-[#1e2a8a]" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />{t('active')}
              </label>
            )}
            <ErrorBox error={formError} />
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setDraft(null)}>{t('cancel')}</button>
              <button className="btn-primary" disabled={busy || !draft.nameEn.trim() || validLines.length === 0} onClick={save}>{busy ? t('loading') : t('save')}</button>
            </div>
          </div>
        )}
      </Sheet>

      <Sheet open={!!viewing} onClose={() => setViewing(null)} title={viewing ? pick(viewing.nameEn, viewing.nameTa) : ''}>
        {viewing && <RecipeDetail recipe={viewing} />}
      </Sheet>
    </div>
  );
}
