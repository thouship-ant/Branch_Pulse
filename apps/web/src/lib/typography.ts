/**
 * The typefaces and text sizes a company can choose for its app (set by the Super Admin on the company form). The ids are what
 * the server stores; every signed-in person of that company sees the app in the chosen face and size.
 *
 * Inter ships with the app. The others are fetched from Google Fonts in the browser, only for a company that picked one (nothing
 * is downloaded at build time, and nobody pays for fonts they do not use).
 */
const FALLBACK = 'var(--font-tamil), ui-sans-serif, system-ui, sans-serif';

export const FONT_OPTIONS = [
  { id: 'INTER', label: 'Inter (standard)', css: 'var(--font-inter)', google: '' },
  { id: 'POPPINS', label: 'Poppins (round, friendly)', css: `"Poppins", ${FALLBACK}`, google: 'Poppins:wght@400;500;600;700;800' },
  { id: 'NUNITO', label: 'Nunito (soft)', css: `"Nunito", ${FALLBACK}`, google: 'Nunito:wght@400;500;600;700;800' },
  { id: 'ROBOTO', label: 'Roboto (neutral)', css: `"Roboto", ${FALLBACK}`, google: 'Roboto:wght@400;500;700;900' },
  { id: 'LORA', label: 'Lora (serif)', css: `"Lora", ${FALLBACK}`, google: 'Lora:wght@400;500;600;700' },
] as const;

/** `px` is the root text size of the page (the whole interface is rem-based, so everything scales with it). */
export const SIZE_OPTIONS = [
  { id: 'SMALL', label: 'Small', short: 'S', px: 14 },
  { id: 'MEDIUM', label: 'Medium', short: 'M', px: 16 },
  { id: 'LARGE', label: 'Large', short: 'L', px: 17.5 },
  { id: 'XLARGE', label: 'Extra large', short: 'XL', px: 19 },
] as const;

export const fontCss = (id?: string | null) => FONT_OPTIONS.find((f) => f.id === id)?.css ?? FONT_OPTIONS[0].css;
export const sizePx = (id?: string | null) => SIZE_OPTIONS.find((s) => s.id === id)?.px ?? 16;

/** Make sure the typeface is available in this browser (adds the Google Fonts stylesheet once). */
export function loadFont(id?: string | null) {
  const font = FONT_OPTIONS.find((f) => f.id === id);
  if (!font || !font.google || typeof document === 'undefined') return;
  const key = `bp-font-${font.id}`;
  if (document.getElementById(key)) return;
  const link = document.createElement('link');
  link.id = key;
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${font.google}&display=swap`;
  document.head.appendChild(link);
}
