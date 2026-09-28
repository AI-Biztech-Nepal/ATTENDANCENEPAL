'use client';

import { useEffect } from 'react';

const RELOAD_FLAG = 'chunk-error-reload-at';
const RELOAD_COOLDOWN_MS = 10_000;

function isChunkLoadError(reason: unknown): boolean {
  if (!reason) return false;
  const name = (reason as { name?: string }).name ?? '';
  const message = (reason as { message?: string }).message ?? String(reason);
  return (
    name === 'ChunkLoadError' ||
    /Loading chunk [\d\w-]+ failed/i.test(message) ||
    /Loading CSS chunk [\d\w-]+ failed/i.test(message)
  );
}

/**
 * A deploy replaces `.next/static/chunks/*` with new hashed filenames, so a
 * tab left open from before the deploy can request a chunk that no longer
 * exists. That 400/404 surfaces as ChunkLoadError (and often a follow-on
 * React hydration error). The fix is just a reload to pick up the new build;
 * the cooldown flag stops a persistently broken deploy from reload-looping.
 */
export default function ChunkErrorReload() {
  useEffect(() => {
    const reloadOnce = () => {
      const lastReload = Number(sessionStorage.getItem(RELOAD_FLAG) ?? 0);
      if (Date.now() - lastReload < RELOAD_COOLDOWN_MS) return;
      sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
      window.location.reload();
    };

    const onError = (event: ErrorEvent) => {
      if (isChunkLoadError(event.error) || isChunkLoadError({ message: event.message })) {
        reloadOnce();
      }
    };

    const onRejection = (event: PromiseRejectionEvent) => {
      if (isChunkLoadError(event.reason)) {
        reloadOnce();
      }
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return null;
}
