import type { Config } from 'tailwindcss';

// Palette values live in CSS variables (globals.css) so light and dark themes swap in one place.
const v = (name: string, shades: number[]) =>
  Object.fromEntries(shades.map((s) => [s, `rgb(var(--${name}-${s}) / <alpha-value>)`]));

export default {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'] },
      colors: {
        brand: { DEFAULT: '#2563eb', dark: '#1d4ed8', light: '#dbeafe' }, // blue primary, AA contrast with white text
        surface: 'rgb(var(--surface) / <alpha-value>)', // cards, sidebar, inputs
        ink: 'rgb(var(--ink) / <alpha-value>)',
        slate: v('slate', [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]),
        emerald: v('emerald', [50, 300, 800, 900]),
        amber: v('amber', [50, 300, 800, 900]),
        red: v('red', [50, 300, 800, 900]),
        violet: v('violet', [50, 300, 800, 900]),
        sky: v('sky', [50, 300, 900]),
      },
      borderRadius: { card: '8px' },
      minHeight: { touch: '48px' }, // >= 48 px touch targets
      minWidth: { touch: '48px' },
    },
  },
  plugins: [],
} satisfies Config;
