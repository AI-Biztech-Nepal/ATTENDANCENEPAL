'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, supabaseConfigured } from '@/lib/supabase';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import ConfigWarning from './ConfigWarning';

type Role = 'admin' | 'hr';

export default function AppShell({ title, children }: { title: string; children: React.ReactNode }) {
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'ready' | 'redirecting'>('loading');
  const [role, setRole] = useState<Role>('admin');
  const [adminName, setAdminName] = useState('Admin');
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (!supabaseConfigured) return;
    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      if (!data.session) {
        router.replace('/login');
        return;
      }
      const { data: profile } = await supabase
        .from('profiles')
        .select('role, full_name')
        .eq('id', data.session.user.id)
        .single();
      if (!active) return;
      if (profile?.role === 'employee' || !profile) {
        // Employees get their own mobile-first pages, never this dashboard.
        setStatus('redirecting');
        router.replace('/checkin');
        return;
      }
      setRole(profile.role as Role);
      setAdminName(profile.full_name || data.session.user.email?.split('@')[0] || 'Admin');
      setStatus('ready');
    });
    return () => {
      active = false;
    };
  }, [router]);

  if (!supabaseConfigured) {
    return <ConfigWarning />;
  }
  if (status !== 'ready') {
    return <div className="flex h-screen items-center justify-center text-slate-400">Loading…</div>;
  }

  return (
    // `print:block` on both wrappers is what stops printed reports losing their
    // last records: Chrome clips a table that spans a page break inside a
    // display:flex ancestor (the rows after the break are cut off mid-row and
    // the TOTAL row never prints). Plain block flow paginates normally, and
    // the layout is otherwise identical on paper — the sidebar/top bar that
    // needed the flex row are print:hidden anyway.
    <div className="flex h-screen overflow-hidden print:block print:h-auto print:overflow-visible">
      <div className="print:hidden">
        <Sidebar role={role} drawerOpen={drawerOpen} onCloseDrawer={() => setDrawerOpen(false)} />
      </div>
      <div className="flex flex-1 flex-col overflow-hidden print:block print:overflow-visible">
        <div className="print:hidden">
          <TopBar title={title} onOpenMenu={() => setDrawerOpen(true)} adminName={adminName} role={role} />
        </div>
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 print:overflow-visible print:p-0">{children}</main>
      </div>
    </div>
  );
}
