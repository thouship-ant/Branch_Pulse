import { Injectable } from '@nestjs/common';
import { currentCompanyId } from './company-context';
import { companyScope, PrismaService } from './prisma.service';

/** Defaults used until the company's admin overrides them in Settings (LLD s2 settings keys, s10 rules). */
export const SETTING_DEFAULTS: Record<string, unknown> = {
  'business.name': 'Branch Pulse',
  'business.type': 'TEA_SHOP', // TEA_SHOP | HOTEL | BAKERY | OTHER
  'fy.start_month': 4,
  'branch.code_prefix': 'BR', // prefix suggested for new branch codes (BR001, BR002 ...)
  'transliteration.external': true, // false = never send names to an external service; use the built-in fallback
  'entry.backdate_days': 3,
  'cash.variance_threshold': 500,
  'stock.variance_pct_default': 5,
  'wastage.high_pct_of_sales': 3,
  'wastage.high_single_entry': 1000,
  'wastage.photo_above': 200,
  'closing.cutoff_time': '23:30',
  'sales.mismatch_tolerance': 0,
  'sales.unusual_pct': 40,
  'expense.receipt_above': 500,
  'expense.unusual_multiple': 3,
  'purchase.rate_deviation_pct': 25, // warn when a purchase rate differs from the last one by more than this
  'advance.max_multiple': 1,
  'alerts.supplier_due_days_before': 3,
  'alerts.approval_pending_hours': 12,
  'alerts.advance_pending_hours': 24,
};

@Injectable()
export class SettingsService {
  /** cache key: companyId + setting key (every company has its own values) */
  private cache = new Map<string, { value: unknown; at: number }>();
  private readonly ttlMs = 30_000;

  constructor(private readonly prisma: PrismaService) {}

  async get<T = unknown>(key: string, companyId: string | null = currentCompanyId()): Promise<T> {
    if (!companyId) return SETTING_DEFAULTS[key] as T; // Super Admin / background work outside a company
    const ck = `${companyId}|${key}`;
    const hit = this.cache.get(ck);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.value as T;
    const row = await this.prisma.runScoped(companyScope(companyId), (tx) =>
      tx.setting.findUnique({ where: { company_id_key: { company_id: companyId, key } } }),
    );
    const value = (row ? row.value : SETTING_DEFAULTS[key]) as T;
    this.cache.set(ck, { value, at: Date.now() });
    return value;
  }

  async getNumber(key: string, companyId: string | null = currentCompanyId()): Promise<number> {
    return Number(await this.get(key, companyId));
  }

  async all(companyId: string | null = currentCompanyId()): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = { ...SETTING_DEFAULTS };
    if (!companyId) return out;
    const rows = await this.prisma.runScoped(companyScope(companyId), (tx) => tx.setting.findMany());
    for (const r of rows) out[r.key] = r.value;
    return out;
  }

  invalidate(key?: string, companyId: string | null = currentCompanyId()) {
    if (key && companyId) this.cache.delete(`${companyId}|${key}`);
    else if (!key && companyId) for (const k of this.cache.keys()) { if (k.startsWith(`${companyId}|`)) this.cache.delete(k); }
    else this.cache.clear();
  }
}
