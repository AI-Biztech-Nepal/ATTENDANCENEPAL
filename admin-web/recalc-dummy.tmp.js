const { createClient } = require('@supabase/supabase-js');
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const EMAIL = 'dummy@gmail.com';
const CID = '3022240a-396c-4330-88e3-25f535f953d8';

async function main() {
  // Session as the dummy company's admin (no password change, no email sent) so RLS scopes the recompute to this company only.
  const { data: link, error: lErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email: EMAIL });
  if (lErr) throw lErr;
  const user = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: vErr } = await user.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' });
  if (vErr) throw vErr;
  const { data: { user: u } } = await user.auth.getUser();
  const { data: me } = await user.from('profiles').select('company_id, role').eq('id', u.id).single();
  if (me.company_id !== CID) throw new Error('wrong company, aborting');

  let total = 0;
  for (let d = new Date(Date.UTC(2026, 8, 2)); d <= new Date(Date.UTC(2026, 8, 30)); d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.toISOString().slice(0, 10);
    const { data, error } = await user.rpc('compute_payroll_summaries', { p_work_date: day });
    if (error) throw new Error(`${day}: ${error.message}`);
    total += data ?? 0;
  }
  console.log('summary rows written:', total);

  const { data: emps } = await admin.from('employees').select('id').eq('company_id', CID);
  const { data: sums } = await admin.from('payroll_summaries').select('work_date').in('employee_id', emps.map(e => e.id)).gte('work_date', '2026-09-02');
  console.log('payroll_summaries for Sep 2+ now:', sums.length);
}
main().catch(e => { console.error('FAILED:', e.message || e); process.exit(1); });
