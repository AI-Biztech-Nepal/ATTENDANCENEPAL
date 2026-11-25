// Ported from admin-web/lib/useOwnKpis.ts — keep the two in step (see mobile-app/README.md, "Shared logic").
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase';
import { MIGRATION, isMissingTable, loadProblem } from './kpiLoad';
import { onlyOn, ownKpisFromRows, type OwnKpi } from './ownKpi';

// The KPIs the company added (KPIs > Settings > "Add your own KPI"), shared by every KPI page the way the settings are:
// the last list read is kept so a page opens with the right columns at once and then checks again, and a save on the
// Settings page reaches every page that is open.
//
// A database that has not had the migration yet has no such table. That is not a problem to report on every KPI page: with
// no table there are no KPIs of your own, and nothing is hidden. Only the Settings page says so, when you try to add one.
let cache: OwnKpi[] | null = null;
let inflight: Promise<{ kpis: OwnKpi[]; error: string; missing: boolean }> | null = null;
const listeners = new Set<(k: OwnKpi[]) => void>();

function publish(next: OwnKpi[]) {
  cache = next;
  listeners.forEach(fn => fn(next));
}

/** Lets every page that is open know the list changed (after Settings saves or removes one). */
export const publishOwnKpis = publish;

async function read() {
  if (!inflight) {
    inflight = (async () => {
      const { data, error } = await supabase.from('custom_kpis').select('id, name, is_on').order('created_at', { ascending: true }).order('id', { ascending: true });
      if (!error) return { kpis: ownKpisFromRows(data as Record<string, unknown>[] | null), error: '', missing: false };
      // A table that is not there means none; any other failure keeps what was last read and says so.
      return isMissingTable(error)
        ? { kpis: [] as OwnKpi[], error: '', missing: true }
        : { kpis: cache ?? [], error: loadProblem('your own KPIs', error, MIGRATION.own), missing: false };
    })().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

export function useOwnKpis() {
  const [kpis, setKpis] = useState<OwnKpi[]>(cache ?? []);
  const [loaded, setLoaded] = useState(cache !== null);
  const [error, setError] = useState('');
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let live = true;
    const hear = (k: OwnKpi[]) => live && setKpis(k);
    listeners.add(hear);
    read()
      .then(r => {
        if (!live) return;
        publish(r.kpis);
        setError(r.error);
        setMissing(r.missing);
        setLoaded(true);
      })
      .catch(e => {
        if (!live) return;
        setError(e instanceof Error ? e.message : 'Could not read your own KPIs.');
        setLoaded(true);
      });
    return () => {
      live = false;
      listeners.delete(hear);
    };
  }, []);

  const inUse = useMemo(() => onlyOn(kpis), [kpis]);
  const reload = useCallback(async () => {
    const r = await read();
    publish(r.kpis);
    setError(r.error);
    setMissing(r.missing);
  }, []);
  return { kpis, inUse, loaded, error, missing, reload };
}
