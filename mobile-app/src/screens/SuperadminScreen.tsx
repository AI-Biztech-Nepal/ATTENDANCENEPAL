import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { API_BASE } from '../lib/accountsApi';
import { colors } from '../theme';
import StatCard from '../components/StatCard';
import Badge from '../components/Badge';

type AdminUser = { id: string; name: string; email: string };
type Company = {
  id: string;
  name: string;
  createdAt: string;
  status: 'active' | 'suspended';
  userCount: number;
  employeeCount: number;
  deviceCount: number;
  adminUsers: AdminUser[];
};
type Stats = { totalCompanies: number; totalUsers: number; totalEmployees: number; totalDevices: number };

// Read-only mobile view of the web /superadmin dashboard: platform totals
// plus every company with its counts and admin/HR contacts. Management
// actions (suspend, delete, impersonate) stay on the web.
export default function SuperadminScreen() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}` };
    try {
      const [statsRes, companiesRes] = await Promise.all([
        fetch(`${API_BASE}/api/superadmin/stats`, { headers }),
        fetch(`${API_BASE}/api/superadmin/companies`, { headers }),
      ]);
      const statsBody = await statsRes.json().catch(() => ({}));
      const companiesBody = await companiesRes.json().catch(() => ({}));
      if (!statsRes.ok) {
        setError(statsBody.error ?? 'Could not load stats.');
        return;
      }
      setError(null);
      setStats(statsBody);
      if (companiesRes.ok) setCompanies(companiesBody.companies);
    } catch {
      setError('Could not reach the server.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = (companies ?? []).filter(c => !q || c.name.toLowerCase().includes(q));
    return rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [companies, search]);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
    >
      <View style={styles.headerRow}>
        <Text style={styles.title}>Superadmin</Text>
        <TouchableOpacity style={styles.signOutBtn} onPress={() => supabase.auth.signOut()}>
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>
      </View>

      {error && <Text style={styles.error}>{error}</Text>}
      {!stats && !error && <ActivityIndicator style={{ marginVertical: 24 }} />}

      {stats && (
        <View style={styles.statsGrid}>
          <StatCard label="Companies" value={String(stats.totalCompanies)} />
          <StatCard label="Users" value={String(stats.totalUsers)} />
          <StatCard label="Employees" value={String(stats.totalEmployees)} />
          <StatCard label="Devices" value={String(stats.totalDevices)} />
        </View>
      )}

      <Text style={styles.sectionTitle}>All Companies</Text>
      <TextInput
        style={styles.search}
        placeholder="Search company…"
        placeholderTextColor={colors.slate400}
        value={search}
        onChangeText={setSearch}
      />
      {companies?.length === 0 && <Text style={styles.muted}>No companies yet.</Text>}
      {companies && companies.length > 0 && filtered.length === 0 && <Text style={styles.muted}>No companies match your search.</Text>}

      {filtered.map(c => (
        <View key={c.id} style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={styles.companyName} numberOfLines={1}>
              {c.name}
            </Text>
            {c.status === 'suspended' && <Badge tone="critical">Suspended</Badge>}
          </View>
          <Text style={styles.muted}>Signed up {c.createdAt.slice(0, 10)}</Text>
          <View style={styles.counts}>
            <Count label="Users" value={c.userCount} />
            <Count label="Employees" value={c.employeeCount} />
            <Count label="Devices" value={c.deviceCount} />
          </View>
          <Text style={styles.adminLabel}>ADMIN / HR USERS</Text>
          {c.adminUsers.length === 0 ? (
            <Text style={styles.muted}>None found.</Text>
          ) : (
            c.adminUsers.map(u => (
              <View key={u.id} style={{ marginTop: 4 }}>
                <Text style={styles.adminName} numberOfLines={1}>
                  {u.name}
                </Text>
                <Text style={styles.muted} numberOfLines={1}>
                  {u.email}
                </Text>
              </View>
            ))
          )}
        </View>
      ))}
    </ScrollView>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={styles.countValue}>{value}</Text>
      <Text style={styles.countLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.slate50 },
  content: { padding: 16, paddingTop: 48 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 22, fontWeight: '700', color: colors.ink },
  signOutBtn: { backgroundColor: colors.criticalBg, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  signOutText: { color: colors.criticalText, fontSize: 12, fontWeight: '700' },
  error: { color: colors.critical, fontSize: 13, marginBottom: 12 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: colors.ink, marginTop: 8, marginBottom: 8 },
  search: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.slate200, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: colors.ink, marginBottom: 12 },
  muted: { fontSize: 12, color: colors.slate500 },
  card: { backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.slate200, padding: 14, marginBottom: 12 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  companyName: { fontSize: 16, fontWeight: '600', color: colors.ink, flexShrink: 1 },
  counts: { flexDirection: 'row', backgroundColor: colors.slate50, borderRadius: 8, paddingVertical: 10, marginVertical: 10 },
  countValue: { fontSize: 14, fontWeight: '700', color: colors.ink },
  countLabel: { fontSize: 11, color: colors.slate500 },
  adminLabel: { fontSize: 10, fontWeight: '600', letterSpacing: 0.5, color: colors.slate400 },
  adminName: { fontSize: 13, fontWeight: '500', color: colors.ink },
});
