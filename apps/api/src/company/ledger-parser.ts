import * as ExcelJS from 'exceljs';

/**
 * Reads the "tea shop ledger" workbook (see assets/tea_shop_ledger_sample.xlsx): Expenses, Staff_Payments and
 * Daily_Closing sheets, plus the ledger date on README. Pure parsing - nothing here touches the database.
 */

export interface ParsedExpense {
  row: number;
  sourceId: string; // Expense ID column (EXP-001 ...)
  date: string; // YYYY-MM-DD
  category: string;
  subCategory: string;
  amount: string; // decimal string, 2 places
  paymentMode: 'CASH' | 'UPI' | 'CARD' | 'BANK_TRANSFER' | 'CHEQUE' | 'CREDIT';
  payee: string;
  description: string;
}

export interface ParsedStaffPayment {
  row: number;
  sourceId: string;
  date: string;
  name: string;
  amount: string;
  notes: string;
}

export interface ParsedClosing {
  openingCash: string | null;
  totalSales: string | null;
  cashSales: string | null;
  upiSales: string | null;
  cardSales: string | null;
  creditSales: string | null;
}

export interface ParsedLedger {
  ledgerDate: string | null;
  expenses: ParsedExpense[];
  staff: ParsedStaffPayment[];
  closing: ParsedClosing;
  errors: Array<{ sheet: string; row: number; message: string }>;
  warnings: Array<{ sheet: string; row: number; message: string }>;
}

const MODES: Record<string, ParsedExpense['paymentMode']> = {
  cash: 'CASH', upi: 'UPI', gpay: 'UPI', phonepe: 'UPI', paytm: 'UPI', card: 'CARD', 'debit card': 'CARD', 'credit card': 'CARD',
  bank: 'BANK_TRANSFER', 'bank transfer': 'BANK_TRANSFER', neft: 'BANK_TRANSFER', imps: 'BANK_TRANSFER', cheque: 'CHEQUE', check: 'CHEQUE', credit: 'CREDIT',
};

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** A cell's plain value: formulas give their result, rich text its text. */
function plain(v: ExcelJS.CellValue): string | number | Date | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date || typeof v === 'number' || typeof v === 'string') return v;
  if (typeof v === 'object') {
    if ('result' in v) return plain((v as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
    if ('richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join('');
    if ('text' in v) return String((v as ExcelJS.CellHyperlinkValue).text);
  }
  return null;
}

function text(v: ExcelJS.CellValue): string {
  const p = plain(v);
  if (p === null) return '';
  if (p instanceof Date) return iso(p);
  return String(p).trim();
}

/** Excel serial number, Date object, dd/mm/yyyy or yyyy-mm-dd -> YYYY-MM-DD (null when it is not a date). */
export function toIsoDate(v: ExcelJS.CellValue): string | null {
  const p = plain(v);
  if (p === null || p === '') return null;
  if (p instanceof Date) return iso(p);
  if (typeof p === 'number') {
    if (p < 20000 || p > 80000) return null;
    return iso(new Date(Math.round((p - 25569) * 86400 * 1000))); // 25569 = 1970-01-01 in Excel's 1900 date system
  }
  const s = p.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return s;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    const yy = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${yy}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
  }
  return null;
}

function money(v: ExcelJS.CellValue): string | null {
  const p = plain(v);
  if (p === null || p === '') return null;
  const n = typeof p === 'number' ? p : Number(String(p).replace(/[₹,\s]/g, ''));
  if (!Number.isFinite(n)) return null;
  return n.toFixed(2);
}

/** A "Total" / "Grand total" line at the foot of a sheet (any cell saying so): never a record. */
function isTotalRow(r: ExcelJS.Row): boolean {
  let found = false;
  r.eachCell((c) => { if (/^(grand\s+)?total$/i.test(text(c.value))) found = true; });
  return found;
}

/**
 * The amount of a row: { skip: true } when it is blank or zero (a name written with no amount is not a record),
 * { error } when something other than a number is there, else the amount as a decimal string.
 */
function amountOf(v: ExcelJS.CellValue): { value: string } | { skip: true } | { error: string } {
  const p = plain(v);
  if (p === null || p === '') return { skip: true };
  const m = money(v);
  if (m === null) return { error: 'Amount must be a number' };
  if (Number(m) === 0) return { skip: true };
  if (Number(m) < 0) return { error: 'Amount cannot be negative' };
  return { value: m };
}

/** Header name -> column number (case/spacing-insensitive), so a re-ordered sheet still imports. */
function headers(ws: ExcelJS.Worksheet): Map<string, number> {
  const out = new Map<string, number>();
  ws.getRow(1).eachCell((c, col) => out.set(text(c.value).toLowerCase().replace(/[^a-z0-9]/g, ''), col));
  return out;
}
const col = (h: Map<string, number>, ...names: string[]) => names.map((n) => h.get(n.toLowerCase().replace(/[^a-z0-9]/g, ''))).find((x) => x !== undefined);

export async function parseLedger(buffer: Buffer): Promise<ParsedLedger> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    throw new Error('That file is not a readable .xlsx workbook');
  }
  const out: ParsedLedger = {
    ledgerDate: null, expenses: [], staff: [],
    closing: { openingCash: null, totalSales: null, cashSales: null, upiSales: null, cardSales: null, creditSales: null },
    errors: [], warnings: [],
  };
  const sheet = (name: string) => wb.worksheets.find((w) => w.name.trim().toLowerCase() === name.toLowerCase());

  // ledger date: README "Ledger date" row
  const readme = sheet('README');
  readme?.eachRow((r) => {
    if (text(r.getCell(1).value).toLowerCase() === 'ledger date') out.ledgerDate = toIsoDate(r.getCell(3).value);
  });

  // ---- Expenses
  const ex = sheet('Expenses');
  if (!ex) out.errors.push({ sheet: 'Expenses', row: 0, message: 'The workbook has no "Expenses" sheet' });
  else {
    const h = headers(ex);
    const cDate = col(h, 'Date'), cCat = col(h, 'Category'), cSub = col(h, 'Sub-category', 'Subcategory'), cAmt = col(h, 'Amount (Rs)', 'Amount'),
      cMode = col(h, 'Payment mode'), cPayee = col(h, 'Supplier / payee', 'Payee', 'Supplier'), cDesc = col(h, 'Description'), cId = col(h, 'Expense ID');
    if (!cAmt || !cCat) out.errors.push({ sheet: 'Expenses', row: 1, message: 'Expenses needs "Category" and "Amount (Rs)" columns' });
    else {
      ex.eachRow((r, n) => {
        if (n === 1 || isTotalRow(r)) return;
        const a = amountOf(r.getCell(cAmt).value);
        const category = text(r.getCell(cCat).value);
        if ('skip' in a) { if (category) out.warnings.push({ sheet: 'Expenses', row: n, message: `${category}: no amount, row skipped` }); return; }
        if ('error' in a) { out.errors.push({ sheet: 'Expenses', row: n, message: a.error }); return; }
        const amount = a.value;
        const date = (cDate ? toIsoDate(r.getCell(cDate).value) : null) ?? out.ledgerDate;
        if (!date) { out.errors.push({ sheet: 'Expenses', row: n, message: 'No date on the row and no ledger date on README' }); return; }
        const modeRaw = cMode ? text(r.getCell(cMode).value).toLowerCase() : '';
        const mode = MODES[modeRaw];
        if (modeRaw && !mode) out.warnings.push({ sheet: 'Expenses', row: n, message: `Payment mode "${modeRaw}" not recognised, imported as Cash` });
        out.expenses.push({
          row: n, sourceId: (cId ? text(r.getCell(cId).value) : '') || `R${n}`, date, category: category || 'Miscellaneous',
          subCategory: cSub ? text(r.getCell(cSub).value) : '', amount, paymentMode: mode ?? 'CASH',
          payee: cPayee ? text(r.getCell(cPayee).value) : '', description: cDesc ? text(r.getCell(cDesc).value) : '',
        });
      });
    }
  }

  // ---- Staff_Payments (optional sheet)
  const sp = sheet('Staff_Payments');
  if (sp) {
    const h = headers(sp);
    const cDate = col(h, 'Date'), cName = col(h, 'Name'), cAmt = col(h, 'Amount (Rs)', 'Amount'), cNotes = col(h, 'Notes'), cId = col(h, 'Record ID');
    if (cName && cAmt) {
      sp.eachRow((r, n) => {
        if (n === 1 || isTotalRow(r)) return;
        const name = text(r.getCell(cName).value);
        if (!name) return; // blank line
        const a = amountOf(r.getCell(cAmt).value);
        if ('skip' in a) { out.warnings.push({ sheet: 'Staff_Payments', row: n, message: `${name}: no amount, row skipped` }); return; }
        if ('error' in a) { out.errors.push({ sheet: 'Staff_Payments', row: n, message: `${name}: ${a.error}` }); return; }
        const amount = a.value;
        const date = (cDate ? toIsoDate(r.getCell(cDate).value) : null) ?? out.ledgerDate;
        if (!date) { out.errors.push({ sheet: 'Staff_Payments', row: n, message: 'No date on the row and no ledger date on README' }); return; }
        out.staff.push({ row: n, sourceId: (cId ? text(r.getCell(cId).value) : '') || `R${n}`, date, name, amount, notes: cNotes ? text(r.getCell(cNotes).value) : '' });
      });
    }
  }

  // ---- Daily_Closing: label in column A, value in column B
  const dc = sheet('Daily_Closing');
  dc?.eachRow((r) => {
    const label = text(r.getCell(1).value).toLowerCase();
    const v = money(r.getCell(2).value);
    if (label.startsWith('opening cash')) out.closing.openingCash = v;
    else if (label.startsWith('total sales')) out.closing.totalSales = v;
    else if (label.startsWith('cash sales')) out.closing.cashSales = v;
    else if (label.startsWith('upi sales')) out.closing.upiSales = v;
    else if (label.startsWith('card')) out.closing.cardSales = v;
    else if (label.startsWith('credit sales')) out.closing.creditSales = v;
  });

  return out;
}
