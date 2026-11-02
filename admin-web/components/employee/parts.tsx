import type { ReactNode } from 'react';

/** Small pieces shared by the employee pages (Check In/Out first). They follow
 * the mobile app's look: the green hero panel, flat uppercase status tags. */

/** The green panel at the top of an employee page. On a phone it is a full-bleed
 * band that continues the green header; from `lg` up it is a rounded panel
 * inside the content column. `pad` leaves room for the card that overlaps its
 * bottom edge: 'check' for Check In/Out's stats card, 'inner' for the other pages. */
export function HeroPanel({ children, pad = 'inner' }: { children: ReactNode; pad?: 'check' | 'inner' }) {
  const padding = pad === 'check' ? 'pb-[88px] lg:pb-[92px]' : 'pb-[60px] lg:pb-[76px]';
  return (
    <section className={`bg-brand px-5 pt-1 text-white lg:rounded-[20px] lg:px-8 lg:pt-7 ${padding}`}>{children}</section>
  );
}

const TAG_TONES = {
  good: 'bg-[#e2f3e8] text-[#14532d]',
  warning: 'bg-[#ffedd5] text-[#c2410c]',
  critical: 'bg-[#fee2e2] text-[#b91c1c]',
  info: 'bg-[#dbeafe] text-[#1d4ed8]',
  neutral: 'bg-slate-200 text-slate-600',
  purple: 'bg-[#f3e8ff] text-[#7e22ce]',
} as const;

export type TagTone = keyof typeof TAG_TONES;

export function StatusTag({ tone, children }: { tone: TagTone; children: ReactNode }) {
  return (
    <span
      className={`inline-block shrink-0 rounded-md px-2 py-[3px] text-[10px] font-bold uppercase tracking-[0.3px] ${TAG_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

type IconProps = { className?: string };
const SVG = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'aria-hidden': true } as const;

export function SignInIcon({ className }: IconProps) {
  return (
    <svg {...SVG} strokeWidth={2.2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" />
    </svg>
  );
}
export function SignOutIcon({ className }: IconProps) {
  return (
    <svg {...SVG} strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
    </svg>
  );
}
export function PinIcon({ className }: IconProps) {
  return (
    <svg {...SVG} strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21s-7-6.1-7-11a7 7 0 1 1 14 0c0 4.9-7 11-7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}
export function EditIcon({ className }: IconProps) {
  return (
    <svg {...SVG} strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}
export function UmbrellaIcon({ className }: IconProps) {
  return (
    <svg {...SVG} strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 12a9 9 0 0 1 18 0Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 12v7a2 2 0 0 1-4 0" />
    </svg>
  );
}
export function ChevronRightIcon({ className }: IconProps) {
  return (
    <svg {...SVG} strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" />
    </svg>
  );
}
export function ChevronLeftIcon({ className }: IconProps) {
  return (
    <svg {...SVG} strokeWidth={2.4} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m15 6-6 6 6 6" />
    </svg>
  );
}
export function CheckCircleIcon({ className }: IconProps) {
  return (
    <svg {...SVG} strokeWidth={2} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m8.5 12.5 2.5 2.5 5-5" />
    </svg>
  );
}
export function ClockIcon({ className }: IconProps) {
  return (
    <svg {...SVG} strokeWidth={2} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 3" />
    </svg>
  );
}
