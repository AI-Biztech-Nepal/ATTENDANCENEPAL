import type { ReactNode } from 'react';

/** Small pieces shared by the employee pages: the page spacing and a few icons. */

/** The outer spacing every employee page uses: the content column's side padding on a computer,
 * a 16px gutter on a phone (the shell's <main> adds none of its own). */
export function PageBody({ children }: { children: ReactNode }) {
  return (
    <div className="lg:px-8 lg:pb-10 lg:pt-7">
      <div className="mx-4 mt-4 lg:mx-0 lg:mt-0">{children}</div>
    </div>
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
export function ClockIcon({ className }: IconProps) {
  return (
    <svg {...SVG} strokeWidth={2} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 3" />
    </svg>
  );
}
