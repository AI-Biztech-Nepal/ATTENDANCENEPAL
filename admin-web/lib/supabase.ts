import { createClient } from '@supabase/supabase-js';

// .trim() guards against the most common real-world mistake: a stray
// trailing newline or space left over from copy-pasting the value into
// Vercel's env var UI, which otherwise produces a URL that *looks* fine but
// makes the underlying fetch() throw a cryptic "Invalid value" error deep
// inside the Supabase SDK instead of a readable message.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

function isValidHttpUrl(value?: string) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// Never throw at module load: this file is imported by every 'use client'
// page, which Next.js also renders once on the server. Throwing here turns a
// missing/malformed env var into a hard 500 (FUNCTION_INVOCATION_FAILED) on
// every route instead of a readable in-page message.
export const supabaseConfigured = isValidHttpUrl(supabaseUrl) && Boolean(supabaseAnonKey);

export const supabase = createClient(
  isValidHttpUrl(supabaseUrl) ? (supabaseUrl as string) : 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key',
  { db: { schema: 'attendance' as 'public' } }
);
