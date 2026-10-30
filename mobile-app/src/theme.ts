// The mobile app's brand green: emerald #047857 replaces the old teal
// #0d9488, which was too light for white text (3.7:1; this is 5.5:1).
// Neutrals and warning/critical/info still mirror admin-web/tailwind.config.ts,
// which keeps its original teal for now.
export const colors = {
  ink: '#0f172a',
  sidebar: '#0f172a',
  slate50: '#f8fafc',
  slate100: '#f1f5f9',
  slate200: '#e2e8f0',
  slate400: '#94a3b8',
  slate500: '#64748b',
  white: '#ffffff',

  accent: '#047857',
  accentLight: '#e3f4ec',

  good: '#15803d',
  goodBg: '#e2f3e8',
  goodText: '#14532d',

  warning: '#f97316',
  warningBg: '#ffedd5',
  warningText: '#c2410c',

  critical: '#ef4444',
  criticalBg: '#fee2e2',
  criticalText: '#b91c1c',

  info: '#2563eb',
  infoBg: '#dbeafe',
  infoText: '#1d4ed8',
};
