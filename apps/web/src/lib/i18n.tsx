'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Lang = 'en' | 'ta';

/**
 * English + Tamil UI (HLD s7). Resource dictionaries live in one place; add keys to BOTH languages.
 * Tamil strings should be reviewed by a native speaker before go-live.
 */
const en = {
  appName: 'Branch Pulse',
  login: 'Sign in', logout: 'Sign out', username: 'Username or mobile', password: 'Password',
  home: 'Home', sales: 'Sales', expense: 'Expense', stock: 'Stock', closing: 'Closing',
  dashboard: 'Dashboard', closings: 'Closings', approvals: 'Approvals',
  today: 'Today', totalSales: 'Total sales', cash: 'Cash', upi: 'UPI', card: 'Card', credit: 'Credit',
  complimentary: 'Complimentary', otherAdjustment: 'Other adjustment', remarks: 'Remarks',
  difference: 'Difference', save: 'Save', saveAndAdd: 'Save & add another', submit: 'Submit',
  submitClosing: 'Submit daily closing', approve: 'Approve', reject: 'Reject', reopen: 'Reopen',
  amount: 'Amount', category: 'Category', payee: 'Paid to', note: 'Note', photo: 'Photo', addPhoto: 'Add receipt photo',
  paymentMode: 'Paid by', expenses: 'Expenses', purchases: 'Purchases', wastage: 'Wastage',
  openingCash: 'Opening cash', expectedCash: 'Expected cash', actualCash: 'Actual cash (counted)',
  variance: 'Difference', shortage: 'Shortage', surplus: 'Surplus', tallied: 'Tallied',
  reason: 'Reason', explanation: 'Explanation', denominations: 'Count the notes',
  pending: 'Pending', submitted: 'Submitted', approved: 'Approved', rejected: 'Rejected', reopened: 'Reopened',
  checklist: 'Today\'s checklist', done: 'Done', notDone: 'Not done',
  exceptions: 'Exceptions', allClosed: 'All branches closed', noExceptions: 'Nothing needs attention',
  branch: 'Branch', net: 'Net', cashVariance: 'Cash variance', status: 'Status',
  vsLastWeek: 'vs same day last week', waiting: 'entries waiting to sync', synced: 'All saved',
  offline: 'Offline - entries will sync when you are back online',
  comment: 'Comment', cancel: 'Cancel', confirm: 'Confirm', loading: 'Loading', retry: 'Try again',
  language: 'தமிழ்', comingSoon: 'This part arrives in the next phase.',
  needReceipt: 'Receipt photo needed', mismatch: 'Split does not match the total',
  prechecks: 'Before you submit', keepMine: 'Keep mine', keepServer: 'Keep server copy',
  conflict: 'Changed elsewhere', history: 'History', reviewComment: 'Owner\'s comment',
  menu: 'Menu', stockNotes: 'Stock notes', otherReceipts: 'Other receipts', supplierAdvances: 'Supplier / advances',
  withdrawals: 'Withdrawals', atLeast10: 'At least 10 characters', cancelled: 'Cancelled', reversed: 'Reversed',
  modeBank: 'Bank',
  chartsTitle: 'Charts', last7: 'Last 7 days', last30: 'Last 30 days', last90: 'Last 90 days', customRange: 'Custom',
  rangeFrom: 'From', rangeTo: 'To', total: 'Total', byBranch: 'By branch', tableView: 'Table', chartView: 'Chart',
  noData: 'No data in this period', noConsumption: 'Stock consumption appears once stock counts are recorded.',
  last12: 'Last 12 months', otherLabel: 'Other', noSales: 'No sales', ofTotal: 'of total', monthToDate: 'current month is month-to-date',
  valueRupees: 'Value (₹)', pctOfSales: '% of sales', daysLabel: 'days', invalidRange: 'Choose a valid range (at most 400 days)',
  cSalesTrend: 'Daily sales trend', cBranchSales: 'Branch-wise sales', cExpenseCats: 'Expense category breakdown',
  cMonthlySales: 'Monthly sales', cMonthlyExpenses: 'Monthly expenses', cBranchProfit: 'Branch-wise profitability',
  cStockUse: 'Stock consumption', cWastage: 'Wastage trend',
  cMarginNote: 'Operating margin: (sales − expenses − wastage) ÷ sales. Central costs and stock cost are not included yet.',
  cStockNote: 'Each item is drawn in its own unit, so every chart has its own axis.',
  relToday: 'Today', relYesterday: 'Yesterday', relThisWeek: 'This week', relLastWeek: 'Last week',
  relThisMonth: 'This month', relLastMonth: 'Last month', relThisQuarter: 'This quarter', relPrevQuarter: 'Previous quarter',
  relThisHalf: 'This half-year', relPrevHalf: 'Previous half-year', relPrevYear: 'Previous year',
  exClosingPending: 'Closing pending', exClosingRejected: 'Closing rejected', exClosingReopened: 'Closing reopened',
  exCashShortage: 'Cash shortage', exCashSurplus: 'Cash surplus', exApprovalPending: 'Expenses waiting over {n}h',
  reasonShortChange: 'Wrong change given', reasonCounting: 'Counting error', reasonCashTaken: 'Cash taken out',
  reasonUnrecorded: 'Unrecorded expense', reasonOther: 'Other',
};

const ta: typeof en = {
  appName: 'Branch Pulse',
  login: 'உள்நுழை', logout: 'வெளியேறு', username: 'பயனர் பெயர் / மொபைல்', password: 'கடவுச்சொல்',
  home: 'முகப்பு', sales: 'விற்பனை', expense: 'செலவு', stock: 'இருப்பு', closing: 'நாள் முடிவு',
  dashboard: 'முகப்புப் பலகை', closings: 'நாள் முடிவுகள்', approvals: 'அங்கீகாரங்கள்',
  today: 'இன்று', totalSales: 'மொத்த விற்பனை', cash: 'ரொக்கம்', upi: 'UPI', card: 'கார்டு', credit: 'கடன்',
  complimentary: 'இலவசம்', otherAdjustment: 'பிற சரிசெய்தல்', remarks: 'குறிப்புகள்',
  difference: 'வித்தியாசம்', save: 'சேமி', saveAndAdd: 'சேமித்து மேலும் சேர்', submit: 'சமர்ப்பி',
  submitClosing: 'நாள் முடிவைச் சமர்ப்பி', approve: 'அங்கீகரி', reject: 'நிராகரி', reopen: 'மீண்டும் திற',
  amount: 'தொகை', category: 'வகை', payee: 'யாருக்கு', note: 'குறிப்பு', photo: 'புகைப்படம்', addPhoto: 'ரசீது புகைப்படம் சேர்',
  paymentMode: 'செலுத்திய முறை', expenses: 'செலவுகள்', purchases: 'கொள்முதல்', wastage: 'வீணானது',
  openingCash: 'தொடக்க ரொக்கம்', expectedCash: 'எதிர்பார்க்கும் ரொக்கம்', actualCash: 'உண்மையான ரொக்கம் (எண்ணியது)',
  variance: 'வித்தியாசம்', shortage: 'பற்றாக்குறை', surplus: 'கூடுதல்', tallied: 'சரியாக உள்ளது',
  reason: 'காரணம்', explanation: 'விளக்கம்', denominations: 'நோட்டுகளை எண்ணுங்கள்',
  pending: 'நிலுவையில்', submitted: 'சமர்ப்பிக்கப்பட்டது', approved: 'அங்கீகரிக்கப்பட்டது', rejected: 'நிராகரிக்கப்பட்டது', reopened: 'மீண்டும் திறக்கப்பட்டது',
  checklist: 'இன்றைய பட்டியல்', done: 'முடிந்தது', notDone: 'முடியவில்லை',
  exceptions: 'கவனிக்க வேண்டியவை', allClosed: 'அனைத்து கிளைகளும் முடிந்தன', noExceptions: 'கவனிக்க எதுவும் இல்லை',
  branch: 'கிளை', net: 'நிகரம்', cashVariance: 'ரொக்க வித்தியாசம்', status: 'நிலை',
  vsLastWeek: 'கடந்த வாரம் அதே நாளுடன்', waiting: 'பதிவுகள் ஒத்திசைவுக்காக காத்திருக்கின்றன', synced: 'அனைத்தும் சேமிக்கப்பட்டன',
  offline: 'இணையம் இல்லை - இணைந்ததும் பதிவுகள் ஒத்திசைக்கப்படும்',
  comment: 'கருத்து', cancel: 'ரத்து', confirm: 'உறுதி', loading: 'ஏற்றுகிறது', retry: 'மீண்டும் முயற்சி',
  language: 'English', comingSoon: 'இந்தப் பகுதி அடுத்த கட்டத்தில் வரும்.',
  needReceipt: 'ரசீது புகைப்படம் தேவை', mismatch: 'பிரிவுகள் மொத்தத்துடன் பொருந்தவில்லை',
  prechecks: 'சமர்ப்பிக்கும் முன்', keepMine: 'என்னுடையதை வை', keepServer: 'சர்வர் பதிவை வை',
  conflict: 'வேறிடத்தில் மாற்றப்பட்டது', history: 'வரலாறு', reviewComment: 'உரிமையாளர் கருத்து',
  menu: 'பட்டி', stockNotes: 'இருப்புக் குறிப்புகள்', otherReceipts: 'பிற வரவுகள்', supplierAdvances: 'சப்ளையர் / முன்பணம்',
  withdrawals: 'எடுப்புகள்', atLeast10: 'குறைந்தது 10 எழுத்துகள்', cancelled: 'ரத்து செய்யப்பட்டது', reversed: 'மாற்றியமைக்கப்பட்டது',
  modeBank: 'வங்கி',
  chartsTitle: 'வரைபடங்கள்', last7: 'கடந்த 7 நாட்கள்', last30: 'கடந்த 30 நாட்கள்', last90: 'கடந்த 90 நாட்கள்', customRange: 'தனிப்பயன்',
  rangeFrom: 'தொடக்கம்', rangeTo: 'முடிவு', total: 'மொத்தம்', byBranch: 'கிளை வாரியாக', tableView: 'அட்டவணை', chartView: 'வரைபடம்',
  noData: 'இந்தக் காலத்தில் தரவு இல்லை', noConsumption: 'இருப்பு எண்ணிக்கை பதிவான பின் பயன்பாடு தோன்றும்.',
  last12: 'கடந்த 12 மாதங்கள்', otherLabel: 'மற்றவை', noSales: 'விற்பனை இல்லை', ofTotal: 'மொத்தத்தில்', monthToDate: 'நடப்பு மாதம் இன்றுவரை',
  valueRupees: 'மதிப்பு (₹)', pctOfSales: 'விற்பனையில் %', daysLabel: 'நாட்கள்', invalidRange: 'சரியான காலத்தைத் தேர்ந்தெடுக்கவும் (அதிகபட்சம் 400 நாட்கள்)',
  cSalesTrend: 'தினசரி விற்பனைப் போக்கு', cBranchSales: 'கிளை வாரியான விற்பனை', cExpenseCats: 'செலவு வகை வாரியான பிரிப்பு',
  cMonthlySales: 'மாதாந்திர விற்பனை', cMonthlyExpenses: 'மாதாந்திர செலவுகள்', cBranchProfit: 'கிளை வாரியான லாபம்',
  cStockUse: 'இருப்புப் பயன்பாடு', cWastage: 'வீணாக்கப் போக்கு',
  cMarginNote: 'இயக்க லாப விகிதம்: (விற்பனை − செலவுகள் − வீணானது) ÷ விற்பனை. மத்திய செலவுகளும் இருப்பு செலவும் இன்னும் சேர்க்கப்படவில்லை.',
  cStockNote: 'ஒவ்வொரு பொருளும் அதன் சொந்த அலகில் வரையப்படுகிறது, எனவே ஒவ்வொரு வரைபடத்திற்கும் தனி அச்சு உள்ளது.',
  relToday: 'இன்று', relYesterday: 'நேற்று', relThisWeek: 'இந்த வாரம்', relLastWeek: 'கடந்த வாரம்',
  relThisMonth: 'இந்த மாதம்', relLastMonth: 'கடந்த மாதம்', relThisQuarter: 'இந்த காலாண்டு', relPrevQuarter: 'முந்தைய காலாண்டு',
  relThisHalf: 'இந்த அரையாண்டு', relPrevHalf: 'முந்தைய அரையாண்டு', relPrevYear: 'முந்தைய ஆண்டு',
  exClosingPending: 'நாள் முடிவு நிலுவையில்', exClosingRejected: 'நாள் முடிவு நிராகரிக்கப்பட்டது', exClosingReopened: 'நாள் முடிவு மீண்டும் திறக்கப்பட்டது',
  exCashShortage: 'ரொக்கப் பற்றாக்குறை', exCashSurplus: 'ரொக்கக் கூடுதல்', exApprovalPending: '{n} மணி நேரத்திற்கு மேல் காத்திருக்கும் செலவுகள்',
  reasonShortChange: 'தவறான சில்லறை கொடுத்தது', reasonCounting: 'எண்ணிக்கைப் பிழை', reasonCashTaken: 'ரொக்கம் எடுக்கப்பட்டது',
  reasonUnrecorded: 'பதிவு செய்யாத செலவு', reasonOther: 'மற்றவை',
};

export type MessageKey = keyof typeof en;
const dictionaries: Record<Lang, typeof en> = { en, ta };

interface I18nCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (k: MessageKey, vars?: Record<string, string | number>) => string;
  /** Pick the Tamil form of master data (branch, category, item) when the UI is Tamil; fall back to English. */
  pick: (en?: string | null, ta?: string | null) => string;
}
const Ctx = createContext<I18nCtx>({ lang: 'en', setLang: () => undefined, t: (k) => en[k], pick: (e) => e ?? '' });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en');
  useEffect(() => {
    try {
      const saved = localStorage.getItem('bp_lang');
      if (saved === 'en' || saved === 'ta') setLangState(saved);
    } catch { /* storage blocked */ }
  }, []);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { localStorage.setItem('bp_lang', l); } catch { /* ignore */ }
    document.documentElement.lang = l;
  }, []);
  const value = useMemo<I18nCtx>(
    () => ({
      lang,
      setLang,
      t: (k, vars) => {
        let s = dictionaries[lang][k] ?? en[k];
        if (vars) for (const [name, v] of Object.entries(vars)) s = s.replace(`{${name}}`, String(v));
        return s;
      },
      pick: (e, ta) => (lang === 'ta' && ta ? ta : (e ?? '')),
    }),
    [lang, setLang],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useT = () => useContext(Ctx);
