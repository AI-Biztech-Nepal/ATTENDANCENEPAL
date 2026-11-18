// Opened from the AIBIZTECH portal (its menu adds ?from=aibiztech)? Remember it for this tab so the sidebar can offer a way back.
// Called on every page load, including the login page, before any redirect drops the address's query.
export const PORTAL_URL = process.env.NEXT_PUBLIC_PORTAL_URL || 'https://aibiztech.vercel.app';

export function rememberPortal(): boolean {
  try {
    if (new URLSearchParams(window.location.search).get('from') === 'aibiztech') sessionStorage.setItem('from_aibiztech', '1');
    return sessionStorage.getItem('from_aibiztech') === '1';
  } catch {
    return false; // storage blocked: no back link, nothing else changes
  }
}
