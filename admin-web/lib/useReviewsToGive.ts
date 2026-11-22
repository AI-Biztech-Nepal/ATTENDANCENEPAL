import { useCallback, useEffect, useState } from 'react';
import { supabase, supabaseConfigured } from './supabase';
import type { ReviewToGive } from './colleagueReviews';

/** The colleague feedback the signed-in person is asked to give in rounds that are still open (given ones too, so
 * they can be changed). `refreshKey` is read again whenever it changes, like the page the person is on. Empty
 * for a login with no employee record. Goes through my_reviews_to_give(), which checks who is asking. */
export function useReviewsToGive(refreshKey?: string) {
  const [items, setItems] = useState<ReviewToGive[] | null>(null);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    if (!supabaseConfigured) return;
    const { data, error: rpcError } = await supabase.rpc('my_reviews_to_give');
    if (rpcError) {
      setError(rpcError.message);
      setItems([]);
      return;
    }
    setError('');
    setItems((data as ReviewToGive[] | null) ?? []);
  }, []);

  useEffect(() => {
    reload();
  }, [reload, refreshKey]);

  return {
    items,
    error,
    reload,
    /** How many are still to give. */
    pending: (items ?? []).filter(i => !i.given_at).length,
    loading: items === null && !error,
  };
}
