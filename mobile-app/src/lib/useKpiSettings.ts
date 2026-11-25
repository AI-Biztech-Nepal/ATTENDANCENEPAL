// Ported from admin-web/lib/useKpiSettings.ts — keep the two in step (see mobile-app/README.md, "Shared logic").
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase';
import { DEFAULT_KPI_SETTINGS, fromRow, wordsFor, type KpiSettings } from './kpiSettings';

// The KPI settings, shared by every KPI page. The last value read is kept so a page opens with the right
// names at once and then checks again; a save (or a read on another page) reaches every page that is open.
let cache: KpiSettings | null = null;
let inflight: Promise<KpiSettings> | null = null;
const listeners = new Set<(s: KpiSettings) => void>();

function publish(next: KpiSettings) {
  cache = next;
  listeners.forEach(fn => fn(next));
}

/** Lets every page that is open know the settings changed (after Settings saves). */
export const publishKpiSettings = publish;

async function read(): Promise<KpiSettings> {
  if (!inflight) {
    inflight = (async () => {
      // `select('*')`: a database that does not have the newest columns yet still gives the ones it has.
      const { data, error } = await supabase.from('kpi_settings').select('*').limit(1);
      // No row, or no access to it: the defaults, which is what a company that never opened Settings uses.
      return error ? (cache ?? fromRow(null)) : fromRow(((data as Record<string, unknown>[] | null) ?? [])[0]);
    })().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

export function useKpiSettings() {
  const [settings, setSettings] = useState<KpiSettings>(cache ?? DEFAULT_KPI_SETTINGS);
  const [loaded, setLoaded] = useState(cache !== null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    const hear = (s: KpiSettings) => live && setSettings(s);
    listeners.add(hear);
    read().then(s => {
      if (!live) return;
      publish(s);
      setLoaded(true);
    }).catch(e => {
      if (!live) return;
      setError(e instanceof Error ? e.message : 'Could not read the KPI settings.');
      setLoaded(true);
    });
    return () => {
      live = false;
      listeners.delete(hear);
    };
  }, []);

  const words = useMemo(() => wordsFor(settings.word), [settings.word]);
  const reload = useCallback(async () => publish(await read()), []);
  return { settings, loaded, words, error, reload };
}
