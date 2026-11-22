'use client';

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Icon, type IconName } from '@/components/Icon';
import { LogoMark } from '@/components/Logo';
import { PasswordChecklist } from '@/components/PasswordChecklist';
import { AutoTextarea, ErrorBox, LabelRow, Sheet, Skeleton, TextField } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { passwordOk } from '@/lib/password';
import { useSession } from '@/lib/session';
import { FONT_OPTIONS, SIZE_OPTIONS, fontCss, sizePx } from '@/lib/typography';

interface Company {
  id: string; code: string; name: string; address: string | null; gstin: string | null; fssai: string | null; email: string | null; status: string;
  businessName?: string; businessType?: string; businessLogo?: string | null; businessFrame?: string | null; businessFont?: string; businessFontSize?: string;
  branchCount: number; admin: { name: string; mobile: string; status: string } | null;
}

/** Banner of a company card, by the business type picked for it (the tea shop uses the same artwork as its own app). */
const TYPE_LOOK: Record<string, { label: string; banner: string; icon: IconName }> = {
  TEA_SHOP: { label: 'Tea shop / café', icon: 'store', banner: 'linear-gradient(90deg, #5f3013, #66331a)' }, // + the cup artwork, see CompanyBanner
  HOTEL: { label: 'Hotel', icon: 'home', banner: 'linear-gradient(120deg, #1e2a78 0%, #3b4cc0 60%, #6b7be0 100%)' },
  BAKERY: { label: 'Bakery', icon: 'bag', banner: 'linear-gradient(120deg, #9a3412 0%, #d9742b 60%, #f2b45e 100%)' },
  RESTAURANT: { label: 'Restaurant', icon: 'store', banner: 'linear-gradient(120deg, #7f1d1d 0%, #b9382f 60%, #e07a5f 100%)' },
  FRUIT_STALL: { label: 'Fruit stall', icon: 'bag', banner: 'linear-gradient(120deg, #9d174d 0%, #d6336c 60%, #f59ab8 100%)' },
  VEGETABLE_SHOP: { label: 'Vegetable shop', icon: 'bag', banner: 'linear-gradient(120deg, #14532d 0%, #2f855a 60%, #7cc48f 100%)' },
  GROCERY: { label: 'Grocery', icon: 'store', banner: 'linear-gradient(120deg, #854d0e 0%, #b7791f 60%, #e6b85c 100%)' },
  OTHER: { label: 'Other business', icon: 'store', banner: 'linear-gradient(120deg, #334155 0%, #475569 60%, #64748b 100%)' },
};

const EMPTY = { companyName: '', businessType: 'TEA_SHOP', adminName: '', mobile: '', email: '', address: '', gstin: '', fssai: '', password: '' };
type Form = typeof EMPTY;

/** Server field errors ([{field,message}]) -> { field: message } so each shows under its own box. */
const fieldErrors = (e: unknown): Record<string, string> =>
  e instanceof ApiError && Array.isArray(e.details) ? Object.fromEntries(e.details.filter((d: any) => d?.field).map((d: any) => [d.field, d.message])) : {};

/**
 * Turns the chosen picture into a small square PNG data URL (transparency is kept) that fits the server's 80 KB limit:
 * the longest side is scaled down to 256 px, then smaller until it fits.
 */
async function logoDataUrl(file: File): Promise<string> {
  if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) throw new Error('Choose a PNG or JPEG image');
  const bitmap = await createImageBitmap(file);
  let side = Math.min(256, Math.max(bitmap.width, bitmap.height));
  for (let i = 0; i < 6; i++) {
    const scale = side / Math.max(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL('image/png');
    if (url.length <= 78_000) { bitmap.close?.(); return url; }
    side = Math.round(side * 0.75);
  }
  bitmap.close?.();
  throw new Error('That image is too detailed to shrink under 80 KB. Try a simpler logo.');
}

/** Used while a tea shop has no logo yet: the standard application colours instead of the tea theme. */
const DEFAULT_BANNER = 'linear-gradient(120deg, #1b2470 0%, #2a3a9c 60%, #4656c4 100%)';

/** Resizes a picture to a JPEG data URL for the application frame: at most 1024 px wide, under ~400 KB. */
async function frameDataUrl(file: File): Promise<string> {
  if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) throw new Error('Choose a PNG or JPEG image');
  const bitmap = await createImageBitmap(file);
  let width = Math.min(1024, bitmap.width);
  let quality = 0.85;
  for (let i = 0; i < 8; i++) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = Math.max(1, Math.round(bitmap.height * (width / bitmap.width)));
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL('image/jpeg', quality);
    if (url.length <= 520_000) { bitmap.close?.(); return url; }
    if (quality > 0.55) quality -= 0.1; else width = Math.round(width * 0.8);
  }
  bitmap.close?.();
  throw new Error('That picture is too detailed to shrink under 400 KB.');
}

/** Shop type picker (shared by the new-company and edit forms). */
function BusinessTypeField({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label htmlFor={id} className="label">Shop type *</label>
      <select id={id} className="field" value={value} onChange={(e) => onChange(e.target.value)}>
        {Object.entries(TYPE_LOOK).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
      </select>
    </div>
  );
}

const look = (c: Company) => TYPE_LOOK[c.businessType ?? 'TEA_SHOP'] ?? TYPE_LOOK.OTHER;

/** The default frame picture is 1024 x 1536; the top of it (header band, cup) is shown behind a card's title. Where the logo sits on the cup: */
const BANNER_H = 148; // height of the banner in the form, so the frame below can carry on at the same scale
const FRAME = { slice: 261 / 1536, cupX: 851 / 1024, cupY: 180 / 261, cupSize: 85 / 1024 };
const SLICE_W = Math.round(BANNER_H * 1024 / 261); // width of the sharp part of the frame in the banner (the slice is 1024 x 261)

/**
 * Banner of a company card, and the live preview in the form: the company's application frame (top of the picture, with its
 * logo printed on the cup) behind the title. With no frame: a tea shop with a logo gets the bundled tea header, a tea shop
 * without one the standard application colours, and the other shop types a colour of their own.
 */
function CompanyBanner({ c, children, height }: { c: Company; children: ReactNode; height?: number }) {
  const tea = (c.businessType ?? 'TEA_SHOP') === 'TEA_SHOP';
  const frame = c.businessFrame;
  const bundled = !frame && tea && !!c.businessLogo;
  const cupLogo = (frame || bundled) && c.businessLogo ? c.businessLogo : null;
  return (
    <div className="relative flex items-start justify-between gap-3 overflow-hidden px-5 pb-6 pt-4 text-white" style={{ height, background: frame ? '#5f3013' : tea && !bundled ? DEFAULT_BANNER : look(c).banner }}>
      {frame && (
        <>
          {/* the picture stretched and blurred fills the width the sharp part does not reach */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 scale-110 blur-[10px]" style={{ backgroundImage: `url("${frame}")`, backgroundSize: '100% auto', backgroundPosition: 'top' }} />
          <div aria-hidden="true" className="pointer-events-none absolute right-0 top-0 h-full overflow-hidden" style={{ aspectRatio: `1024 / ${FRAME.slice * 1536}`, WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 22%)', maskImage: 'linear-gradient(90deg, transparent, #000 22%)' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={frame} alt="" className="block w-full max-w-none" />
            {cupLogo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={cupLogo} alt="" className="absolute rounded-full bg-[#fbf1e3] object-contain ring-1 ring-[#713817]/35" style={{ left: `${FRAME.cupX * 100}%`, top: `${FRAME.cupY * 100}%`, width: `${FRAME.cupSize * 100}%`, aspectRatio: '1', transform: 'translate(-50%, -50%)' }} />
            )}
          </div>
        </>
      )}
      {bundled && (
        <div aria-hidden="true" className="pointer-events-none absolute right-0 top-0 h-full" style={{ aspectRatio: '904 / 202' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/tea-shop-banner.png" alt="" className="h-full w-full max-w-none" style={{ WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 22%)', maskImage: 'linear-gradient(90deg, transparent, #000 22%)' }} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={c.businessLogo!} alt="" className="absolute rounded-full bg-[#fbf1e3] object-contain ring-1 ring-[#713817]/35" style={{ left: `${(777 / 904) * 100}%`, top: `${(166 / 202) * 100}%`, width: '7.2%', aspectRatio: '1', transform: 'translate(-50%, -50%)' }} />
        </div>
      )}
      {children}
    </div>
  );
}

/** A round icon button on a company card (its name shows as a tooltip and is read out by screen readers). */
function CardAction({ label, icon, onClick, tone = 'brand' }: { label: string; icon: IconName; onClick: () => void; tone?: 'brand' | 'danger' | 'ok' }) {
  const color = tone === 'danger' ? 'text-red-700 hover:bg-red-50' : tone === 'ok' ? 'text-emerald-700 hover:bg-emerald-50' : 'text-brand hover:bg-brand-light';
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className={`flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-surface transition active:scale-95 ${color}`}>
      <Icon name={icon} size={18} />
    </button>
  );
}

/** What is written on the banner: logo, code, name, shop type and status. */
function BannerContent({ c, onEditLogo, onEditFrame }: { c: Company; onEditLogo?: () => void; onEditFrame?: () => void }) {
  return (
    <>
      <span className="relative shrink-0">
        {c.businessLogo
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={c.businessLogo} alt="" aria-hidden="true" className="h-14 w-14 rounded-full bg-white/90 object-contain p-0.5 shadow-md ring-2 ring-white/60" />
          : <LogoMark size={56} />}
        {onEditLogo && (
          <button
            type="button" onClick={onEditLogo} aria-label="Change logo" title="Change logo"
            className="absolute -right-1.5 -top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-white text-brand shadow-md ring-1 ring-black/10 transition hover:scale-105 hover:bg-brand-light focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <Icon name="pencil" size={14} />
          </button>
        )}
      </span>
      <div className="relative min-w-0 flex-1">
        <p className="font-mono text-xs text-white/75">{c.code}</p>
        <h3 className="truncate text-xl font-extrabold tracking-tight [text-shadow:0_1px_2px_rgb(0_0_0/0.35)]">{c.name}</h3>
        <p className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-semibold backdrop-blur-sm">
          <Icon name={look(c).icon} size={13} />{look(c).label}
        </p>
      </div>
      <span className="relative flex shrink-0 items-center gap-2">
        <span className={`chip ${c.status === 'ACTIVE' ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-slate-300 bg-slate-100 text-slate-600'}`}>
          {c.status === 'ACTIVE' ? 'Active' : 'Inactive'}
        </span>
        {onEditFrame && (
          <button
            type="button" onClick={onEditFrame} aria-label="Change application frame" title="Change application frame"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-brand shadow-md ring-1 ring-black/10 transition hover:scale-105 hover:bg-brand-light focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <Icon name="pencil" size={15} />
          </button>
        )}
      </span>
    </>
  );
}

/** Super Admin: every company on the platform, and a form to add one with its first Admin. */
export default function CompaniesPage() {
  const { t } = useT();
  const { can } = useSession();
  const [rows, setRows] = useState<Company[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [toggling, setToggling] = useState<Company | null>(null);
  const [editing, setEditing] = useState<Company | null>(null);
  const [usersOf, setUsersOf] = useState<Company | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setRows(await api.get('/super/companies')); setError(null); } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function confirmToggle() {
    if (!toggling) return;
    setBusy(true);
    try {
      await api.patch(`/super/companies/${toggling.id}`, { status: toggling.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' });
      setToggling(null);
      await load();
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not update'); setToggling(null); }
    finally { setBusy(false); }
  }

  if (!can('company:manage')) return <p className="card">{t('noAccess')}</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">{t('companiesTitle')}</h2>
          <p className="text-sm text-slate-600">Each company has its own branches, staff and data. Only you can see all of them.</p>
        </div>
        <button className="btn-primary" onClick={() => setAdding(true)}><Icon name="plus" size={18} /> New company</button>
      </div>
      <ErrorBox error={error} />

      {!rows ? <Skeleton className="h-48" /> : rows.length === 0 ? (
        <div className="card text-center text-slate-600">No companies yet. Add the first one.</div>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {rows.map((c) => (
            <li key={c.id} className="card overflow-hidden p-0">
              <CompanyBanner c={c}><BannerContent c={c} /></CompanyBanner>
              <div className="space-y-3 p-5 pt-4">
              <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                <div><dt className="text-slate-500">Admin</dt><dd className="font-medium">{c.admin ? `${c.admin.name} · ${c.admin.mobile}` : '—'}</dd></div>
                <div><dt className="text-slate-500">Email</dt><dd className="truncate font-medium">{c.email ?? '—'}</dd></div>
                <div><dt className="text-slate-500">GSTIN</dt><dd className="font-medium tabular-nums">{c.gstin ?? '—'}</dd></div>
                <div><dt className="text-slate-500">FSSAI</dt><dd className="font-medium tabular-nums">{c.fssai ?? '—'}</dd></div>
                <div className="sm:col-span-2"><dt className="text-slate-500">Main shop / head office</dt><dd className="font-medium">{c.address ?? '—'}</dd></div>
              </dl>
              <div className="flex items-center justify-between border-t pt-3 text-sm">
                <span className="text-slate-600">{c.branchCount} {c.branchCount === 1 ? 'branch' : 'branches'}</span>
                <span className="flex items-center justify-end gap-1.5">
                  <CardAction label="Users" icon="users" onClick={() => setUsersOf(c)} />
                  <CardAction label="Edit company" icon="pencil" onClick={() => setEditing(c)} />
                  <CardAction
                    label={c.status === 'ACTIVE' ? 'Deactivate' : 'Activate'} icon={c.status === 'ACTIVE' ? 'banCircle' : 'checkCircle'}
                    tone={c.status === 'ACTIVE' ? 'danger' : 'ok'} onClick={() => setToggling(c)}
                  />
                </span>
              </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Sheet wide open={adding} onClose={() => setAdding(false)} title="New company">
        <CompanyForm onSaved={() => { setAdding(false); void load(); }} />
      </Sheet>

      <Sheet wide open={!!editing} onClose={() => setEditing(null)} title={editing ? `Edit ${editing.name} (${editing.code})` : 'Edit company'}>
        {editing && <CompanyForm company={editing} onSaved={() => { setEditing(null); void load(); }} />}
      </Sheet>

      <Sheet open={!!usersOf} onClose={() => setUsersOf(null)} title={`Users · ${usersOf?.name ?? ''}`}>
        {usersOf && <CompanyUsers company={usersOf} onChanged={() => void load()} />}
      </Sheet>

      <Sheet open={!!toggling} onClose={() => setToggling(null)} title={toggling?.status === 'ACTIVE' ? 'Deactivate company?' : 'Activate company?'}>
        <div className="space-y-4">
          <p className="text-sm text-slate-700">
            {toggling?.status === 'ACTIVE'
              ? `Nobody in ${toggling?.name} will be able to sign in until you activate it again. Their data is kept.`
              : `People in ${toggling?.name} will be able to sign in again.`}
          </p>
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setToggling(null)}>{t('cancel')}</button>
            <button className={toggling?.status === 'ACTIVE' ? 'btn-danger' : 'btn-primary'} disabled={busy} onClick={confirmToggle}>{busy ? t('loading') : t('confirm')}</button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}

function SectionTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-3">
      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">{children}</h3>
      {hint && <p className="mt-0.5 text-sm text-slate-600">{hint}</p>}
    </div>
  );
}

/** One upload box: a preview, the buttons, and what the picture is for. */
function PictureField({ title, hint, value, round, onPick, onClear, error }: {
  title: string; hint: string; value: string; round?: boolean; onPick: (file: File) => void; onClear: () => void; error: string | null;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
      <p className="label">{title}</p>
      <div className="mt-1 flex items-center gap-4">
        <span className={`flex shrink-0 items-center justify-center overflow-hidden border border-slate-200 bg-white ${round ? 'h-20 w-20 rounded-full' : 'h-28 w-[74px] rounded-xl'}`}>
          {value
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={value} alt={`${title} preview`} className={round ? 'h-full w-full object-contain' : 'h-full w-full object-cover object-top'} />
            : <span className="px-1 text-center text-[11px] leading-tight text-slate-500">Default</span>}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <label className="btn-secondary min-h-[40px] cursor-pointer px-4 text-sm">
            {value ? 'Replace' : 'Upload'}
            <input type="file" accept="image/png,image/jpeg" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onPick(f); }} />
          </label>
          {value && <button type="button" className="rounded-full px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50" onClick={onClear}>Remove</button>}
        </div>
      </div>
      <p className="mt-2 text-xs leading-snug text-slate-600">{hint}</p>
      {error && <p role="alert" className="mt-1 text-sm text-red-700">{error}</p>}
    </div>
  );
}

/**
 * Add a company (with its first Admin) or edit one. Branding comes first, with a live preview of the top of the app as the
 * Admin and the other roles will see it: the frame picture, the logo on the cup, the name.
 */
function CompanyForm({ company, onSaved }: { company?: Company; onSaved: () => void }) {
  const { t } = useT();
  const editing = !!company;
  const [f, setF] = useState(() => company
    ? { ...EMPTY, companyName: company.name, businessType: company.businessType ?? 'TEA_SHOP', email: company.email ?? '', address: company.address ?? '', gstin: company.gstin ?? '', fssai: company.fssai ?? '' }
    : EMPTY);
  const [logo, setLogo] = useState<string>(company?.businessLogo ?? '');
  const [frame, setFrame] = useState<string | null>(null); // null = unchanged (edit) / none (add), '' = back to the default
  const [logoError, setLogoError] = useState<string | null>(null);
  const [font, setFont] = useState(company?.businessFont ?? 'INTER');
  const [fontSize, setFontSize] = useState(company?.businessFontSize ?? 'MEDIUM');
  const [logoOpen, setLogoOpen] = useState(false);
  const [frameOpen, setFrameOpen] = useState(false);
  const [frameError, setFrameError] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof Form, v: string) => { setF((s) => ({ ...s, [k]: v })); setErrors((e) => { const n = { ...e }; delete n[k]; return n; }); };
  const err = (k: string) => errors[k] && <p className="mt-1 text-sm text-red-700">{errors[k]}</p>;
  const framePreview = frame === null ? company?.businessFrame ?? '' : frame;

  const mobileOk = /^\d{10}$/.test(f.mobile);
  const baseOk = f.companyName.trim().length >= 2 && /^\S+@\S+\.\S+$/.test(f.email) && f.address.trim().length >= 5;
  const ready = editing ? baseOk : baseOk && f.adminName.trim() && mobileOk && (!f.password || passwordOk(f.password));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError(null); setErrors({});
    try {
      if (company) {
        await api.patch(`/super/companies/${company.id}`, {
          companyName: f.companyName.trim(), businessType: f.businessType, email: f.email.trim(), address: f.address.trim(), gstin: f.gstin.trim().toUpperCase(), fssai: f.fssai.trim(),
          ...(logo !== (company.businessLogo ?? '') ? { businessLogo: logo } : {}),
          ...(frame !== null ? { businessFrame: frame } : {}),
          ...(font !== (company.businessFont ?? 'INTER') ? { businessFont: font } : {}),
          ...(fontSize !== (company.businessFontSize ?? 'MEDIUM') ? { businessFontSize: fontSize } : {}),
        });
      } else {
        await api.post('/super/companies', {
          companyName: f.companyName.trim(), businessType: f.businessType, adminName: f.adminName.trim(), mobile: f.mobile, email: f.email.trim(), address: f.address.trim(),
          gstin: f.gstin.trim().toUpperCase() || undefined, fssai: f.fssai.trim() || undefined, password: f.password || undefined,
          businessLogo: logo || undefined, businessFrame: frame || undefined, businessFont: font, businessFontSize: fontSize,
        });
      }
      onSaved();
    } catch (err2) {
      setErrors(fieldErrors(err2));
      setError(err2 instanceof ApiError ? err2.message : 'Could not save');
      setBusy(false);
    }
  }

  const preview: Company = {
    id: company?.id ?? 'new', code: company?.code ?? 'NEW', name: f.companyName.trim() || 'Company name', address: null, gstin: null, fssai: null, email: null,
    status: company?.status ?? 'ACTIVE', branchCount: 0, admin: null, businessType: f.businessType, businessLogo: logo || null, businessFrame: framePreview || null,
  };

  return (
    <form onSubmit={submit} className="space-y-7">

      {/* stays at the top while the fields below scroll under it; the frame carries on straight into the fields */}
      <div className="sticky top-0 z-10 -mx-1 bg-surface px-1 pt-4">
        <div className="group relative mb-2 flex items-center gap-1.5">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Branding</span>
          <button type="button" aria-label="Tip" className="flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 text-[11px] font-bold leading-none text-slate-500 transition hover:bg-slate-100 focus-visible:bg-slate-100">i</button>
          <div role="tooltip" className="pointer-events-none absolute left-0 top-full z-30 mt-1.5 hidden w-80 max-w-[85vw] rounded-xl bg-slate-900 px-3 py-2.5 text-xs font-normal normal-case leading-relaxed tracking-normal text-white shadow-lg group-focus-within:block group-hover:block">
            Use the pencils to change the logo and the application frame. This is how the top of the app looks for every role.
            {editing && <> To change the Admin&apos;s mobile number or reset a password, open <b>Users</b>.</>}
          </div>
        </div>
        <div className="overflow-hidden rounded-t-2xl">
          <CompanyBanner c={preview} height={BANNER_H}><BannerContent c={preview} onEditLogo={() => setLogoOpen(true)} onEditFrame={() => setFrameOpen(true)} /></CompanyBanner>
        </div>
      </div>

      {/* the rest of the frame picture, carried on from the banner above (same scale, same right edge), behind the fields */}
      <div className="relative !mt-0 overflow-hidden rounded-b-2xl bg-slate-50">
        {framePreview && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={framePreview} alt="" aria-hidden="true" className="pointer-events-none absolute left-0 top-0 w-full max-w-none origin-top scale-110 blur-[10px]" style={{ transform: `translateY(-${FRAME.slice * 100}%) scale(1.1)` }} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={framePreview} alt="" aria-hidden="true" className="pointer-events-none absolute right-0 top-0 max-w-none"
              style={{ width: SLICE_W, transform: `translateY(-${FRAME.slice * 100}%)`, WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 22%)', maskImage: 'linear-gradient(90deg, transparent, #000 22%)' }}
            />
          </>
        )}
        <div className="relative space-y-4 p-3 sm:p-4">
        <section className="rounded-2xl bg-surface/90 p-4 shadow-sm ring-1 ring-black/5 backdrop-blur-sm">
          <SectionTitle>Business</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><TextField id="cf-n" label="Company name *" value={f.companyName} onChange={(e) => set('companyName', e.target.value)} maxLength={120} required />{err('companyName')}</div>
            <BusinessTypeField id="cf-b" value={f.businessType} onChange={(v) => set('businessType', v)} />
          </div>
        </section>

        <section className="rounded-2xl bg-surface/90 p-4 shadow-sm ring-1 ring-black/5 backdrop-blur-sm">
          <SectionTitle hint="The typeface and text size the Admin, Branch Admin, Accountant and Stock Manager of this company see in the app.">Font</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="cf-font" className="label">Font style</label>
              <select id="cf-font" className="field" value={font} onChange={(e) => setFont(e.target.value)}>
                {FONT_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <span className="label" id="cf-size-l">Font size</span>
              <div role="radiogroup" aria-labelledby="cf-size-l" className="grid grid-cols-4 gap-1.5">
                {SIZE_OPTIONS.map((o) => (
                  <button
                    key={o.id} type="button" role="radio" aria-checked={fontSize === o.id} aria-label={o.label} title={o.label} onClick={() => setFontSize(o.id)}
                    className={`min-h-[44px] rounded-xl border px-1 text-sm font-semibold transition ${fontSize === o.id ? 'border-brand bg-brand text-white shadow-sm' : 'border-slate-300 bg-surface text-slate-700 hover:bg-slate-100'}`}
                  >
                    {o.short}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-3 rounded-xl border border-slate-200 bg-white/70 p-3" style={{ fontFamily: fontCss(font), fontSize: `${sizePx(fontSize) / 16}rem`, lineHeight: 1.45 }}>
            <p className="font-extrabold" style={{ fontSize: '1.4em' }}>Good morning, Admin</p>
            <p className="text-slate-700">Total sales today <b>₹2,35,480</b> · 6 of 7 branches closed</p>
          </div>
        </section>

        <section className="rounded-2xl bg-surface/90 p-4 shadow-sm ring-1 ring-black/5 backdrop-blur-sm">
          <SectionTitle>Contact</SectionTitle>
          <div className="space-y-4">
            <div><TextField id="cf-e" label="Email *" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} required />{err('email')}</div>
            <div><AutoTextarea id="cf-a" label="Main shop / head office address *" value={f.address} onChange={(v) => set('address', v)} minRows={2} />{err('address')}</div>
          </div>
        </section>

        <section className="rounded-2xl bg-surface/90 p-4 shadow-sm ring-1 ring-black/5 backdrop-blur-sm">
          <SectionTitle>Registration</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><TextField id="cf-g" label="GSTIN (optional)" value={f.gstin} onChange={(e) => set('gstin', e.target.value.toUpperCase().slice(0, 15))} placeholder="33ABCDE1234F1Z5" />{err('gstin')}</div>
            <div><TextField id="cf-f" label="FSSAI licence no. (optional)" inputMode="numeric" value={f.fssai} onChange={(e) => set('fssai', e.target.value.replace(/\D/g, '').slice(0, 14))} placeholder="14 digits" />{err('fssai')}</div>
          </div>
        </section>

        {!editing && (
          <section className="rounded-2xl bg-surface/90 p-4 shadow-sm ring-1 ring-black/5 backdrop-blur-sm">
            <SectionTitle hint="The first Admin of this company.">Admin</SectionTitle>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><TextField id="cf-an" label="Admin full name *" value={f.adminName} onChange={(e) => set('adminName', e.target.value)} maxLength={100} required />{err('adminName')}</div>
              <div><TextField id="cf-am" label="Admin mobile number *" inputMode="numeric" value={f.mobile} onChange={(e) => set('mobile', e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="10 digits" required />{err('mobile')}</div>
            </div>
            <div className="mt-4">
              <LabelRow htmlFor="cf-pw" hint="The Admin signs in with this and an OTP, and is asked to change it at the first sign-in.">Admin password <span className="font-normal text-slate-500">(optional: leave blank to use the default Admin@1234)</span></LabelRow>
              <div className="relative">
                <input id="cf-pw" className="field pr-12" type={show ? 'text' : 'password'} autoComplete="new-password" value={f.password} onChange={(e) => set('password', e.target.value)} />
                <button
                  type="button" onClick={() => setShow((s) => !s)} aria-label={show ? t('hidePassword') : t('showPassword')} aria-pressed={show}
                  className="absolute right-1.5 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-ink"
                >
                  <Icon name={show ? 'eyeOff' : 'eye'} size={19} />
                </button>
              </div>
              {err('password')}
              {f.password && <div className="mt-2"><PasswordChecklist value={f.password} /></div>}
            </div>
          </section>
        )}
        </div>
      </div>

      <ErrorBox error={error} />
      <Sheet open={logoOpen} onClose={() => setLogoOpen(false)} title="Business logo">
        <div className="space-y-4">
        <PictureField
          title="Business logo" round value={logo} error={logoError}
          hint="PNG or JPEG. A transparent PNG keeps its transparent background. Shown in the app header, on the cup and in the browser tab."
          onPick={(file) => { setLogoError(null); logoDataUrl(file).then(setLogo, (x) => setLogoError(x instanceof Error ? x.message : 'Could not read the image')); }}
          onClear={() => { setLogo(''); setLogoError(null); }}
        />
          <button type="button" className="btn-primary w-full" onClick={() => setLogoOpen(false)}>Done</button>
        </div>
      </Sheet>
      <Sheet open={frameOpen} onClose={() => setFrameOpen(false)} title="Application frame">
        <div className="space-y-4">
          <PictureField
            title="Application frame" value={framePreview} error={frameError}
            hint="The app's background: a tall picture (2:3) with the header band and an empty cup at the top. Your logo is placed on the cup. Without one the standard theme is used."
            onPick={(file) => { setFrameError(null); frameDataUrl(file).then(setFrame, (x) => setFrameError(x instanceof Error ? x.message : 'Could not read the image')); }}
            onClear={() => { setFrame(''); setFrameError(null); }}
          />
          <button type="button" className="btn-primary w-full" onClick={() => setFrameOpen(false)}>Done</button>
        </div>
      </Sheet>
      <button className="btn-primary w-full" disabled={busy || !ready}>{busy ? t('loading') : editing ? 'Save changes' : 'Create company'}</button>
    </form>
  );
}

interface CUser { id: string; fullName: string; username: string; mobile: string | null; email: string | null; status: string; roles: string[]; lastLoginAt: string | null; mustChangePassword: boolean; locations: string[] }
const ROLE_LABEL: Record<string, string> = { ADMIN: 'Admin', ACCOUNTANT: 'Accountant', STOCK_MANAGER: 'Stock Manager', BRANCH_MANAGER: 'Branch Admin', STAFF: 'Staff' };
/** Only an Admin has a password (the others sign in with an OTP), so only an Admin can have it reset. */
const hasPassword = (roles: string[]) => roles.includes('ADMIN');
const roleText = (roles: string[]) => roles.map((r) => ROLE_LABEL[r] ?? r).join(', ');

/** Every user of one company: change name / mobile / email, reset the password (a temporary one is sent by SMS). */
function CompanyUsers({ company, onChanged }: { company: Company; onChanged: () => void }) {
  const [users, setUsers] = useState<CUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<CUser | null>(null);
  const [reset, setReset] = useState<CUser | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setUsers(await api.get(`/super/companies/${company.id}/users`)); setError(null); } catch (e: any) { setError(e.message); }
  }, [company.id]);
  useEffect(() => { void load(); }, [load]);

  if (edit) return <EditUser user={edit} onCancel={() => setEdit(null)} onSaved={() => { setEdit(null); setNotice('User updated'); void load(); onChanged(); }} />;
  if (reset) return <ResetPassword user={reset} onDone={(msg) => { setReset(null); setNotice(msg); void load(); }} onCancel={() => setReset(null)} />;

  return (
    <div className="space-y-3">
      <ErrorBox error={error} />
      {notice && <p role="status" className="rounded-card border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">✓ {notice}</p>}
      {!users ? <Skeleton className="h-40" /> : users.length === 0 ? <p className="text-sm text-slate-600">No users yet.</p> : (
        <ul className="divide-y">
          {users.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <div className="min-w-0">
                <p className="truncate font-medium">{u.fullName} {u.status !== 'ACTIVE' && <span className="chip ml-1 border-slate-300 bg-slate-100 text-slate-600">Inactive</span>}</p>
                <p className="text-sm text-slate-600">{roleText(u.roles)} · <span className="tabular-nums">{u.mobile ?? 'no mobile'}</span></p>
                {u.locations.length > 0 && <p className="text-xs text-slate-500">{u.locations.join(', ')}</p>}
                {u.mustChangePassword && hasPassword(u.roles) && <p className="text-xs text-amber-800">⚠ still on the default / temporary password</p>}
              </div>
              <div className="flex gap-2">
                <button className="btn-secondary min-h-[40px] px-3 text-sm" onClick={() => { setNotice(null); setEdit(u); }}>Edit</button>
                {hasPassword(u.roles) && <button className="btn-secondary min-h-[40px] px-3 text-sm" onClick={() => { setNotice(null); setReset(u); }}>Reset password</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EditUser({ user, onCancel, onSaved }: { user: CUser; onCancel: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ fullName: user.fullName, mobile: user.mobile ?? '', email: user.email ?? '', active: user.status === 'ACTIVE' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const err = (k: string) => errors[k] && <p className="mt-1 text-sm text-red-700">{errors[k]}</p>;
  const mobileChanged = f.mobile !== (user.mobile ?? '');

  async function save() {
    setBusy(true); setError(null); setErrors({});
    try {
      await api.patch(`/super/users/${user.id}`, {
        fullName: f.fullName.trim(), mobile: f.mobile || undefined, email: f.email.trim() || undefined, status: f.active ? 'ACTIVE' : 'INACTIVE',
      });
      onSaved();
    } catch (e) {
      setErrors(fieldErrors(e));
      setError(e instanceof ApiError ? e.message : 'Could not save');
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">{roleText(user.roles)}</p>
      <div><TextField id="eu-n" label="Full name" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} maxLength={100} />{err('fullName')}</div>
      <div>
        <TextField id="eu-m" label="Mobile number" inputMode="numeric" value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value.replace(/\D/g, '').slice(0, 10) })} placeholder="10 digits" />
        {err('mobile') ?? (mobileChanged && <p className="mt-1 text-xs text-amber-800">This is the sign-in name. The user will be signed out and must use the new number from now on.</p>)}
      </div>
      <div><TextField id="eu-e" label="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />{err('email')}</div>
      <label className="flex min-h-touch items-center gap-3"><input type="checkbox" className="h-5 w-5" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active (can sign in)</label>
      <ErrorBox error={error} />
      <div className="flex justify-end gap-2">
        <button className="btn-secondary" onClick={onCancel} disabled={busy}>Back</button>
        <button className="btn-primary" onClick={save} disabled={busy || f.fullName.trim().length < 2 || (f.mobile !== '' && !/^\d{10}$/.test(f.mobile))}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  );
}

function ResetPassword({ user, onDone, onCancel }: { user: CUser; onDone: (msg: string) => void; onCancel: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devPassword, setDevPassword] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function run() {
    setBusy(true); setError(null);
    try {
      const r = await api.post(`/super/users/${user.id}/reset-password`);
      if (r.tempPassword) { setDevPassword(r.tempPassword); setSentTo(r.mobile); } // SMS gateway not configured (development)
      else onDone(`A temporary password was sent by SMS to ${r.mobile} (${user.fullName}).`);
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not reset the password'); }
    finally { setBusy(false); }
  }

  if (devPassword) {
    return (
      <div className="space-y-4">
        <p role="status" className="rounded-card border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          The SMS gateway is not configured on this server, so no SMS was sent to {sentTo}. Temporary password (development only):
          <b className="ml-1 select-all font-mono">{devPassword}</b>
        </p>
        <button className="btn-primary w-full" onClick={() => onDone(`Password reset for ${user.fullName} (SMS not configured).`)}>Done</button>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-700">
        Reset the password of <b>{user.fullName}</b> ({roleText(user.roles)})? A temporary password is sent by SMS to <b className="tabular-nums">{user.mobile ?? '—'}</b>
        {' '}and they must change it at the next sign-in. They are signed out everywhere now.
      </p>
      <ErrorBox error={error} />
      <div className="flex justify-end gap-2">
        <button className="btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className="btn-danger" onClick={run} disabled={busy || !user.mobile}>{busy ? 'Sending…' : 'Reset and send SMS'}</button>
      </div>
    </div>
  );
}
