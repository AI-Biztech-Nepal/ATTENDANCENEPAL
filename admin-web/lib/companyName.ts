'use client';

import { useEffect, useState } from 'react';
import { supabase, supabaseConfigured } from './supabase';

/** The signed-in person's company name: '' until it loads, and if it can't be
 * read. RLS lets everyone read only their own company's row, so there is nothing
 * to filter. Not cached across pages — a different login (or a superadmin
 * stepping into a company) must never see the previous company's name. */
export function useCompanyName(): string {
  const [name, setName] = useState('');

  useEffect(() => {
    if (!supabaseConfigured) return;
    let active = true;
    supabase
      .from('companies')
      .select('name')
      .limit(1)
      .then(({ data }) => {
        if (active) setName((data?.[0]?.name as string | null | undefined)?.trim() ?? '');
      });
    return () => {
      active = false;
    };
  }, []);

  return name;
}
