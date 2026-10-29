import * as SecureStore from 'expo-secure-store';
import { Alert, type AlertButton } from 'react-native';
import { TA_EXTRA } from './ta-extra';
import { TA_WEB } from './ta-web';

export type Lang = 'en' | 'ta';

/**
 * Tamil support. The screens are written in English; `tr()` looks the English text up in the dictionary (the web app's table
 * plus ta-extra.ts for mobile-only text) and returns the Tamil. Text that is not in the dictionary (names, numbers, server
 * messages) stays as it is. Tamil strings should be reviewed by a native speaker before go-live.
 */
let current: Lang = 'en';
export const getLang = (): Lang => current;
export const setCurrentLang = (l: Lang) => { current = l; };

const DICT: Record<string, string> = { ...TA_WEB, ...TA_EXTRA };
const LOWER = new Map<string, string>(Object.entries(DICT).map(([k, v]) => [k.toLowerCase(), v]));

// splits a sentence-like string at separators, keeping them: "Sales · 5 entries (Today)" -> Sales | · | 5 entries | ( | Today | )
const SPLIT = /(\s·\s|\s—\s|\s-\s|\s\|\s|[(),:;/]|\s→\s)/;
const NUM = /^([\d,.₹%+−×\-\s]+)(.*)$/;
const NUM_AFTER = /^(.*?)([\s]*[\d,.₹%+−×\-]+[\d%]?)$/;

function lookup(s: string): string | undefined {
  return DICT[s] ?? LOWER.get(s.toLowerCase());
}

/** One trimmed piece: exact match, then "12 entries" / "entries 12" / plural "branches" forms. */
function piece(core: string): string {
  const hit = lookup(core);
  if (hit) return hit;
  const lead = core.match(NUM);
  if (lead && lead[2].trim()) { const rest = lookup(lead[2].trim()); if (rest) return `${lead[1].trimEnd()} ${rest}`; }
  const tail = core.match(NUM_AFTER);
  if (tail && tail[1].trim()) { const rest = lookup(tail[1].trim()); if (rest) return `${rest}${tail[2]}`; }
  // trailing "…" / "!" / "." / "*"
  const m = core.match(/^(.*?)([.…!*:]+)$/);
  if (m) { const rest = lookup(m[1].trim()); if (rest) return `${rest}${m[2]}`; }
  // a leading mark: "✓ Saved", "+ Add", "− Expenses", "← Back"
  const mark = core.match(/^([✓✕⚠⛔◔○●▲▼↺←→+−⟳]+\s*)(.+)$/);
  if (mark) { const rest = lookup(mark[2].trim()); if (rest) return `${mark[1]}${rest}`; }
  // simple English plural -> singular key
  if (/s$/.test(core)) { const sing = lookup(core.slice(0, -1)); if (sing) return sing; }
  return core;
}

// whole sentences with a name or a number inside
const TEMPLATES: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^(.+) will have to sign in again on every device\.$/, (m) => `${m[1]} ஒவ்வொரு சாதனத்திலும் மீண்டும் உள்நுழைய வேண்டும்.`],
  [/^Deactivate (.+)\?$/, (m) => `${m[1]} ஐ செயலிழக்கச் செய்யவா?`],
  [/^Activate (.+)\?$/, (m) => `${m[1]} ஐ செயல்படுத்தவா?`],
  [/^Edit (.+)$/, (m) => `${m[1]} ஐத் திருத்து`],
  [/^Pay (.+)$/, (m) => `${m[1]} க்கு செலுத்து`],
  [/^Resend in (\d+)s$/, (m) => `${m[1]} வி-இல் மீண்டும் அனுப்பலாம்`],
  [/^Imported (\d+) expenses? and (\d+) staff payments? into (.+?) \((.+?)\)\. They are waiting for approval in (.+)\.$/, (m) => `${m[1]} செலவுகளும் ${m[2]} ஊழியர் கொடுப்பனவுகளும் ${m[3]} (${m[4]}) இல் இறக்குமதி செய்யப்பட்டன. அவை ${m[5]} இல் அங்கீகாரத்திற்காகக் காத்திருக்கின்றன.`],
  [/^A temporary password was sent by SMS to (.+?) \((.+)\)\.$/, (m) => `தற்காலிக கடவுச்சொல் ${m[1]} (${m[2]}) க்கு SMS மூலம் அனுப்பப்பட்டது.`],
  [/^Password reset for (.+) \(SMS not configured\)\.$/, (m) => `${m[1]} க்கான கடவுச்சொல் மீட்டமைக்கப்பட்டது (SMS அமைக்கப்படவில்லை).`],
  [/^Cannot reach the server at (.+?)\. Check your connection \((.+)\)\.$/, (m) => `${m[1]} இல் சேவையகத்தை அடைய முடியவில்லை. இணைப்பைச் சரிபார்க்கவும் (${m[2]}).`],
  [/^(\d+) of (\d+) shown$/, (m) => `${m[2]} இல் ${m[1]} காட்டப்படுகிறது`],
  [/^Last (\d+) days$/, (m) => `கடந்த ${m[1]} நாட்கள்`],
  [/^(\d+) days$/, (m) => `${m[1]} நாட்கள்`],
  [/^Photo (\d+) saved$/, (m) => `புகைப்படம் ${m[1]} சேமிக்கப்பட்டது`],
  [/^Photo (\d+)$/, (m) => `புகைப்படம் ${m[1]}`],
  [/^Item (\d+)$/, (m) => `பொருள் ${m[1]}`],
  [/^Ingredient (\d+)$/, (m) => `மூலப்பொருள் ${m[1]}`],
  [/^(\d+) branch(?:es)?$/, (m) => `${m[1]} ${m[1] === '1' ? 'கிளை' : 'கிளைகள்'}`],
  [/^(\d+) count(?:s)? waiting for your approval$/, (m) => `${m[1]} எண்ணிக்கைகள் உங்கள் அங்கீகாரத்திற்காகக் காத்திருக்கின்றன`],
  [/^Period: (.+)$/, (m) => `காலம்: ${m[1]}`],
  [/^(.+) company users?$/, (m) => `${m[1]} பயனர்கள்`],
];

/** Translate English UI text to the current language (identity when English). Surrounding spaces are kept. */
export function tr(text: string): string {
  if (current === 'en' || !text) return text;
  const lead = text.match(/^\s*/)![0];
  const trail = text.match(/\s*$/)![0];
  const body = text.trim();
  if (!body) return text;
  const whole = lookup(body);
  if (whole) return lead + whole + trail;
  for (const [re, build] of TEMPLATES) { const m = body.match(re); if (m) return lead + build(m) + trail; }
  const out = body.split(SPLIT).map((part, i) => {
    if (i % 2 === 1) return part; // a separator
    const sp = part.match(/^(\s*)(.*?)(\s*)$/)!;
    return sp[2] ? sp[1] + piece(sp[2]) + sp[3] : part;
  }).join('');
  return lead + out + trail;
}

/** The Tamil form of master data (branch, category, item) when the language is Tamil; English when there is none. */
export const pickName = (en?: string | null, ta?: string | null) => (current === 'ta' && ta ? ta : (en ?? ''));

const KEY = 'bp_lang';
export async function loadLang(): Promise<Lang> {
  try { const v = await SecureStore.getItemAsync(KEY); return v === 'ta' ? 'ta' : 'en'; } catch { return 'en'; }
}
export async function saveLang(l: Lang) {
  try { await SecureStore.setItemAsync(KEY, l); } catch { /* storage unavailable */ }
}

/** Tamil month names for dates ("29 அக் 2026"). */
export const TA_MONTHS = ['ஜன', 'பிப்', 'மார்', 'ஏப்', 'மே', 'ஜூன்', 'ஜூலை', 'ஆக', 'செப்', 'அக்', 'நவ', 'டிச'];

/** Alert.alert with its title, message and button texts translated. */
export function tAlert(title: string, message?: string, buttons?: AlertButton[]) {
  Alert.alert(tr(title), message ? tr(message) : undefined, buttons?.map((b) => ({ ...b, text: b.text ? tr(b.text) : b.text })));
}
