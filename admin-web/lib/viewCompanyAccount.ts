import { supabase } from './supabase';

// Real "View their account" — shared by the superadmin Dashboard's company
// cards (one click) and CompanyDetailModal's button (behind a confirm).
//
// Stashes this superadmin's own tokens (so ImpersonationBanner can restore
// them later) before switching this tab's session to the target login via
// verifyOtp() — see /api/superadmin/companies/[id]/impersonate for how the
// token_hash it returns was minted, and lib/superadmin's requireSuperadmin
// for the allowlist gate on generating it in the first place. Throws on any
// failure; on success it navigates away and never returns.
export async function viewCompanyAccount(companyId: string): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession();
  const returnSession = sessionData.session;
  if (!returnSession) throw new Error('Your own session expired — refresh and sign in again.');

  const res = await fetch(`/api/superadmin/companies/${companyId}/impersonate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${returnSession.access_token}`, 'Content-Type': 'application/json' },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? 'Request failed.');

  sessionStorage.setItem(
    'impersonation_return',
    JSON.stringify({
      returnAccessToken: returnSession.access_token,
      returnRefreshToken: returnSession.refresh_token,
      companyName: body.company.name,
      asEmail: body.asUser.email,
      asRole: body.asUser.role,
    })
  );

  const { error: verifyError } = await supabase.auth.verifyOtp({ token_hash: body.tokenHash, type: 'magiclink' });
  if (verifyError) throw verifyError;

  window.location.href = '/';
}
