'use client';

import { useEffect, useRef } from 'react';

/** A photo shown large over the page. Closes on the × button, a click outside the photo, or Escape. */
export default function PhotoViewer({
  src,
  name,
  onClose,
  onChange,
}: {
  src: string;
  name: string;
  onClose: () => void;
  /** When given, a "Change photo" button is offered under the picture. */
  onChange?: () => void;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  // Kept in a ref so the keyboard listener below is set up once, not on every render of the page.
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    closeButton.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <div role="dialog" aria-modal="true" aria-label={`${name} — photo`} onClick={onClose} className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-black/80 p-4">
      <button
        ref={closeButton}
        type="button"
        aria-label="Close photo"
        onClick={onClose}
        className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-2xl leading-none text-white hover:bg-white/25"
      >
        ×
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={name} onClick={e => e.stopPropagation()} className="max-h-[78vh] max-w-[92vw] rounded-2xl bg-white object-contain shadow-2xl" />
      <div className="mt-4 flex items-center gap-3" onClick={e => e.stopPropagation()}>
        <span className="text-sm font-bold text-white">{name}</span>
        {onChange && (
          <button type="button" onClick={onChange} className="rounded-lg bg-white px-3.5 py-2 text-sm font-extrabold text-ink hover:bg-slate-100">
            Change photo
          </button>
        )}
      </div>
    </div>
  );
}
