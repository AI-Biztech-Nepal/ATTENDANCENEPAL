import { Manrope } from 'next/font/google';

// Manrope, the mobile app's typeface (mobile-app/src/lib/fonts.ts), for the
// owner/HR pages. Self-hosted by next/font: the files ship with the build,
// so browsers never request them from Google.
export const manrope = Manrope({ subsets: ['latin'], display: 'swap' });
