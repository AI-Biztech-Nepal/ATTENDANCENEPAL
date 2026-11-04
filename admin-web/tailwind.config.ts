import type { Config } from 'tailwindcss';

// accent / good / info read CSS variables (app/globals.css) so the employee portal — which wears the
// `.theme-employee` class — can be one green with neutral greys, while the owner console keeps the
// colours it has always had. `<alpha-value>` keeps `bg-accent/10` and friends working.
const themed = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0f172a',
        sidebar: '#0f172a',
        'sidebar-active': '#1e293b',
        accent: {
          DEFAULT: themed('accent'),
          light: themed('accent-light'),
        },
        // The mobile app's emerald (mobile-app/src/theme.ts) — used by the
        // redesigned owner Dashboard and top bar.
        brand: {
          DEFAULT: '#047857',
          light: '#e3f4ec',
          bar: '#a7d0c4',
          // The employee pages' sidebar (components/EmployeeShell.tsx).
          deep: '#064e3b',
        },
        good: { DEFAULT: themed('good'), bg: themed('good-bg'), text: themed('good-text') },
        warning: { DEFAULT: '#f97316', bg: '#ffedd5', text: '#c2410c' },
        critical: { DEFAULT: '#ef4444', bg: '#fee2e2', text: '#b91c1c' },
        info: { DEFAULT: themed('info'), bg: themed('info-bg'), text: themed('info-text') },
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
