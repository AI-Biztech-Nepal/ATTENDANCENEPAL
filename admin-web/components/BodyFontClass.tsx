'use client';

import { useEffect } from 'react';

/**
 * Adds a font class to <body> while mounted. Date pickers, the roster cell
 * picker and confirm dialogs portal to <body>, outside any page wrapper, so
 * this is what makes them match the page's font; it's removed again on
 * leaving (e.g. signing out to /login).
 */
export default function BodyFontClass({ className }: { className: string }) {
  useEffect(() => {
    const classes = className.split(' ').filter(Boolean);
    document.body.classList.add(...classes);
    return () => document.body.classList.remove(...classes);
  }, [className]);
  return null;
}
