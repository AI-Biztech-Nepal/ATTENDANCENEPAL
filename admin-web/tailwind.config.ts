import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0f172a',
        sidebar: '#0f172a',
        'sidebar-active': '#1e293b',
        accent: {
          DEFAULT: '#0d9488',
          light: '#ccfbf1',
        },
        // The mobile app's emerald (mobile-app/src/theme.ts) — used by the
        // redesigned owner Dashboard and top bar.
        brand: {
          DEFAULT: '#047857',
          light: '#e3f4ec',
          bar: '#a7d0c4',
        },
        good: { DEFAULT: '#0d9488', bg: '#ccfbf1', text: '#0f766e' },
        warning: { DEFAULT: '#f97316', bg: '#ffedd5', text: '#c2410c' },
        critical: { DEFAULT: '#ef4444', bg: '#fee2e2', text: '#b91c1c' },
        info: { DEFAULT: '#2563eb', bg: '#dbeafe', text: '#1d4ed8' },
        dept: {
          engineering: '#0d9488',
          operations: '#2563eb',
          marketing: '#f97316',
          sales: '#a855f7',
          support: '#ec4899',
        },
      },
    },
  },
  plugins: [],
};

export default config;
