import 'react-native-gesture-handler';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Image, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import * as LocalAuthentication from 'expo-local-authentication';
import { useFonts } from 'expo-font';
import { MANROPE_FONTS, applyManropeGlobally } from './src/lib/fonts';
import { AuthProvider, useAuth } from './src/lib/AuthContext';
import { CalendarSystemProvider } from './src/lib/CalendarSystemContext';
import LoginScreen from './src/screens/LoginScreen';
import CheckInScreen from './src/screens/CheckInScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import LeaveRequestScreen from './src/screens/LeaveRequestScreen';
import FixPunchScreen from './src/screens/FixPunchScreen';
import EmployeesScreen from './src/screens/EmployeesScreen';
import EmployeeDetailScreen from './src/screens/EmployeeDetailScreen';
import AdminPayrollDetailScreen from './src/screens/AdminPayrollDetailScreen';
import PayrollScreen from './src/screens/PayrollScreen';
import TasksScreen from './src/screens/TasksScreen';
import DevicesScreen from './src/screens/DevicesScreen';
import LeaveApprovalScreen from './src/screens/LeaveApprovalScreen';
import CorrectionsScreen from './src/screens/CorrectionsScreen';
import BranchesScreen from './src/screens/BranchesScreen';
import SuperadminScreen from './src/screens/SuperadminScreen';
import CalendarScreen from './src/screens/CalendarScreen';
import ShiftsScreen from './src/screens/ShiftsScreen';
import MyCalendarScreen from './src/screens/MyCalendarScreen';
import MyPayrollScreen from './src/screens/MyPayrollScreen';
import MyTasksScreen from './src/screens/MyTasksScreen';
import MyProfileScreen from './src/screens/MyProfileScreen';
import ApprovalsScreen from './src/screens/ApprovalsScreen';
import MoreScreen from './src/screens/MoreScreen';
import AdminHeader from './src/navigation/AdminHeader';
import EmployeeHeader from './src/navigation/EmployeeHeader';
import UpdateBanner from './src/components/UpdateBanner';
import { useUpdateCheck } from './src/lib/useUpdateCheck';
import { PendingApprovalsProvider, usePendingApprovals } from './src/lib/PendingApprovals';
import { colors } from './src/theme';
import {
  CalendarIcon,
  CardIcon,
  CheckCircleIcon,
  GridIcon,
  HomeIcon,
  InboxIcon,
  PersonIcon,
  TaskIcon,
  UsersIcon,
} from './src/components/icons';

// Employee-facing flow mirrors admin-web's EmployeeShell: a 5-tab bottom bar
// (Check In/Out, Calendar, Payroll, Tasks, Profile) with Leave reached as a
// sub-page pushed from Check In/Out, not its own tab — same as the web.
export type EmployeeTabParamList = {
  CheckIn: undefined;
  Calendar: undefined;
  Payroll: undefined;
  Tasks: undefined;
  Profile: undefined;
};
const EmployeeTab = createBottomTabNavigator<EmployeeTabParamList>();

export type EmployeeStackParamList = {
  EmployeeTabs: undefined;
  Leave: undefined;
  FixPunch: undefined;
};
const EmployeeStack = createNativeStackNavigator<EmployeeStackParamList>();

// Shared by the employee and owner tab bars so the two always look alike.
function tabBarOptions(insets: { bottom: number }) {
  return {
    // Taller than the default to fit the active-tab dot under the label;
    // insets.bottom keeps it clear of gesture/nav bars.
    tabBarStyle: {
      backgroundColor: colors.white,
      borderTopColor: colors.slate200,
      height: 62 + insets.bottom,
      paddingTop: 6,
      paddingBottom: 6 + insets.bottom,
    },
    tabBarActiveTintColor: colors.accent,
    tabBarInactiveTintColor: colors.slate500,
    tabBarLabel: ({ focused, color, children }: { focused: boolean; color: string; children: string }) => (
      <View style={styles.tabLabel}>
        <Text style={[styles.tabLabelText, { color, fontWeight: focused ? '800' : '600' }]}>{children}</Text>
        <View style={[styles.tabDot, focused && { backgroundColor: colors.accent }]} />
      </View>
    ),
  };
}

function EmployeeTabNavigator() {
  const insets = useSafeAreaInsets();
  return (
    <EmployeeTab.Navigator
      // 'history' so the header's back button (and Android's) returns to
      // the previously visited tab instead of always jumping to Check In.
      backBehavior="history"
      screenOptions={{
        header: props => <EmployeeHeader {...props} />,
        ...tabBarOptions(insets),
      }}
    >
      <EmployeeTab.Screen
        name="CheckIn"
        component={CheckInScreen}
        options={{ title: 'Check In/Out', tabBarIcon: ({ color, size }) => <CheckCircleIcon size={size} color={color} /> }}
      />
      <EmployeeTab.Screen
        name="Calendar"
        component={MyCalendarScreen}
        options={{ title: 'Calendar', tabBarIcon: ({ color, size }) => <CalendarIcon size={size} color={color} /> }}
      />
      <EmployeeTab.Screen
        name="Payroll"
        component={MyPayrollScreen}
        options={{ title: 'Payroll', tabBarIcon: ({ color, size }) => <CardIcon size={size} color={color} /> }}
      />
      <EmployeeTab.Screen
        name="Tasks"
        component={MyTasksScreen}
        options={{ title: 'My Tasks', tabBarIcon: ({ color, size }) => <TaskIcon size={size} color={color} /> }}
      />
      <EmployeeTab.Screen
        name="Profile"
        component={MyProfileScreen}
        options={{ title: 'Profile', tabBarIcon: ({ color, size }) => <PersonIcon size={size} color={color} /> }}
      />
    </EmployeeTab.Navigator>
  );
}

// Owner/HR flow (mobile only — admin-web keeps its sidebar): a 5-tab bottom
// bar like the employee app — Home, Approvals, Employees, Payroll, More —
// where More holds everything the old side menu had beyond those. Each tab
// is its own stack so sub-pages (Employee Details, Shifts, …) push under the
// shared AdminHeader and get its back button.
const AdminTab = createBottomTabNavigator();
const HomeStack = createNativeStackNavigator();
const ApprovalsStack = createNativeStackNavigator();
const EmployeesAdminStack = createNativeStackNavigator();
const PayrollAdminStack = createNativeStackNavigator();
const MoreStack = createNativeStackNavigator();
const adminStackOptions = { header: (props: any) => <AdminHeader {...props} /> };

function HomeStackScreen() {
  return (
    <HomeStack.Navigator screenOptions={adminStackOptions}>
      <HomeStack.Screen name="Dashboard" component={DashboardScreen} options={{ title: 'Home' }} />
    </HomeStack.Navigator>
  );
}
function ApprovalsStackScreen() {
  return (
    <ApprovalsStack.Navigator screenOptions={adminStackOptions}>
      <ApprovalsStack.Screen name="Approvals" component={ApprovalsScreen} options={{ title: 'Approvals' }} />
    </ApprovalsStack.Navigator>
  );
}
function EmployeesStackScreen() {
  return (
    <EmployeesAdminStack.Navigator screenOptions={adminStackOptions}>
      <EmployeesAdminStack.Screen name="EmployeesList" component={EmployeesScreen} options={{ title: 'Employees' }} />
      <EmployeesAdminStack.Screen name="EmployeeDetail" component={EmployeeDetailScreen} options={{ title: 'Employee Details' }} />
    </EmployeesAdminStack.Navigator>
  );
}
function PayrollStackScreen() {
  return (
    <PayrollAdminStack.Navigator screenOptions={adminStackOptions}>
      <PayrollAdminStack.Screen name="Payroll" component={PayrollScreen} options={{ title: 'Payroll' }} />
      <PayrollAdminStack.Screen name="PayrollDetail" component={AdminPayrollDetailScreen} options={{ title: 'Payroll Detail' }} />
    </PayrollAdminStack.Navigator>
  );
}
function MoreStackScreen() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  return (
    <MoreStack.Navigator screenOptions={adminStackOptions}>
      <MoreStack.Screen name="More" component={MoreScreen} options={{ title: 'More' }} />
      <MoreStack.Screen name="Attendance" component={HistoryScreen} options={{ title: 'Attendance' }} />
      <MoreStack.Screen name="Calendar" component={CalendarScreen} options={{ title: 'Attendance Calendar' }} />
      <MoreStack.Screen name="Corrections" component={CorrectionsScreen} options={{ title: 'Attendance Corrections' }} />
      <MoreStack.Screen name="Leave" component={LeaveApprovalScreen} options={{ title: 'Leave' }} />
      <MoreStack.Screen name="Tasks" component={TasksScreen} options={{ title: 'Tasks & Rewards' }} />
      {isAdmin && (
        <>
          <MoreStack.Screen name="Shifts" component={ShiftsScreen} options={{ title: 'Shift Roster Management' }} />
          <MoreStack.Screen name="Branches" component={BranchesScreen} options={{ title: 'Branch / Department' }} />
          <MoreStack.Screen name="Devices" component={DevicesScreen} options={{ title: 'Biometric Sync Devices' }} />
          <MoreStack.Screen name="Resigned" component={EmployeesScreen} initialParams={{ filter: 'Resigned' }} options={{ title: 'Resigned' }} />
          <MoreStack.Screen name="EmployeeDetail" component={EmployeeDetailScreen} options={{ title: 'Employee Details' }} />
        </>
      )}
    </MoreStack.Navigator>
  );
}

function AdminTabNavigator() {
  const insets = useSafeAreaInsets();
  const { total: pendingTotal } = usePendingApprovals();
  return (
    <AdminTab.Navigator backBehavior="history" screenOptions={{ headerShown: false, ...tabBarOptions(insets) }}>
      <AdminTab.Screen
        name="HomeTab"
        component={HomeStackScreen}
        options={{ title: 'Home', tabBarIcon: ({ color, size }) => <HomeIcon size={size} color={color} /> }}
      />
      <AdminTab.Screen
        name="ApprovalsTab"
        component={ApprovalsStackScreen}
        options={{
          title: 'Approvals',
          tabBarIcon: ({ color, size }) => <InboxIcon size={size} color={color} />,
          tabBarBadge: pendingTotal > 0 ? pendingTotal : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.critical, fontSize: 10, fontWeight: '800' },
        }}
      />
      <AdminTab.Screen
        name="EmployeesTab"
        component={EmployeesStackScreen}
        options={{ title: 'Employees', tabBarIcon: ({ color, size }) => <UsersIcon size={size} color={color} /> }}
      />
      <AdminTab.Screen
        name="PayrollTab"
        component={PayrollStackScreen}
        options={{ title: 'Payroll', tabBarIcon: ({ color, size }) => <CardIcon size={size} color={color} /> }}
      />
      <AdminTab.Screen
        name="MoreTab"
        component={MoreStackScreen}
        options={{ title: 'More', tabBarIcon: ({ color, size }) => <GridIcon size={size} color={color} /> }}
      />
    </AdminTab.Navigator>
  );
}

function AppInner() {
  const { session, profile, loading, isSuperadmin, justSignedIn, clearJustSignedIn } = useAuth();
  const updateInfo = useUpdateCheck();
  // Bundled font files, so this resolves almost instantly. On a load error
  // the app still opens, just in the system font.
  const [fontsLoaded, fontError] = useFonts(MANROPE_FONTS);
  if (fontsLoaded) applyManropeGlobally();

  // Only ever true on a device that actually has biometrics set up — a
  // phone with no fingerprint/face enrolled never locks at all instead of
  // blocking access with a feature it can't satisfy.
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [locked, setLocked] = useState(false);
  const [authenticating, setAuthenticating] = useState(false);

  const authenticate = useCallback(async () => {
    setAuthenticating(true);
    try {
      const result = await LocalAuthentication.authenticateAsync({ promptMessage: 'Unlock Attendance Nepal' });
      if (result.success) setLocked(false);
    } finally {
      setAuthenticating(false);
    }
  }, []);

  // Locks once a session exists on a biometric-capable device — but not
  // right after the user just typed their password to get here. Signing in
  // already proved identity once; re-checked per session (rather than once
  // at app start) so a session restored from a previous cold start still
  // locks, and only that case, on this same phone.
  useEffect(() => {
    if (!session) {
      setLocked(false);
      setBiometricAvailable(false);
      return;
    }
    let active = true;
    (async () => {
      const [hasHardware, isEnrolled] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
      ]);
      if (!active) return;
      const available = hasHardware && isEnrolled;
      setBiometricAvailable(available);
      if (available && !justSignedIn) {
        setLocked(true);
        authenticate();
      }
      if (justSignedIn) clearJustSignedIn();
    })();
    return () => {
      active = false;
    };
  }, [session, authenticate, justSignedIn, clearJustSignedIn]);

  // Re-lock only on a real background->active transition, not the
  // momentary 'inactive' state the biometric prompt itself causes — a
  // naive "lock on every active event" would immediately re-lock right
  // after a successful unlock. A system dialog (the GPS/location
  // permission prompt Check In triggers, photo library picker, etc.) can
  // also flip Android's AppState through 'background' and back within a
  // second or two even though the user never actually left the app — a
  // short grace window tells that apart from a genuine app-switch (user
  // presses home, opens another app, comes back later) without weakening
  // security for the case that actually matters.
  useEffect(() => {
    if (!biometricAvailable) return;
    let prevState = AppState.currentState;
    let backgroundedAt: number | null = null;
    const sub = AppState.addEventListener('change', nextState => {
      if (nextState === 'background') backgroundedAt = Date.now();
      if (prevState === 'background' && nextState === 'active') {
        const briefSystemDialog = backgroundedAt !== null && Date.now() - backgroundedAt < 2000;
        if (!briefSystemDialog) {
          setLocked(true);
          authenticate();
        }
      }
      prevState = nextState;
    });
    return () => sub.remove();
  }, [biometricAvailable, authenticate]);

  if ((!fontsLoaded && !fontError) || loading || (session && isSuperadmin === null)) {
    return (
      <View style={styles.webOuter}>
        <View style={[styles.webInner, { justifyContent: 'center', alignItems: 'center' }]}>
          <ActivityIndicator size="large" />
        </View>
      </View>
    );
  }

  if (locked) {
    return (
      <View style={styles.webOuter}>
        <View style={[styles.webInner, styles.lockScreen]}>
          {/* eslint-disable-next-line @typescript-eslint/no-require-imports */}
          <Image source={require('./assets/icon.png')} style={styles.lockLogo} resizeMode="contain" />
          <Text style={styles.lockTitle}>Locked</Text>
          <Text style={styles.lockSubtitle}>Unlock with your fingerprint or face to continue.</Text>
          <TouchableOpacity onPress={authenticate} disabled={authenticating} style={styles.unlockButton}>
            <Text style={styles.unlockButtonText}>{authenticating ? 'Verifying…' : '👆 Unlock with biometric'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.webOuter}>
      <View style={styles.webInner}>
        {updateInfo && <UpdateBanner downloadUrl={updateInfo.downloadUrl} />}
        <NavigationContainer>
          {!session ? (
            <LoginScreen />
          ) : isSuperadmin ? (
            <SuperadminScreen />
          ) : profile?.role === 'admin' || profile?.role === 'hr' ? (
            <PendingApprovalsProvider>
              <AdminTabNavigator />
            </PendingApprovalsProvider>
          ) : (
            <EmployeeStack.Navigator
              screenOptions={{
                header: props => <EmployeeHeader {...props} />,
              }}
            >
              <EmployeeStack.Screen name="EmployeeTabs" component={EmployeeTabNavigator} options={{ headerShown: false }} />
              <EmployeeStack.Screen name="Leave" component={LeaveRequestScreen} options={{ title: 'Leave Requests' }} />
              <EmployeeStack.Screen name="FixPunch" component={FixPunchScreen} options={{ title: 'Fix a Missed Punch' }} />
            </EmployeeStack.Navigator>
          )}
        </NavigationContainer>
      </View>
    </View>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <CalendarSystemProvider>
          <AppInner />
        </CalendarSystemProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}

// On an actual phone this is a no-op (the card already fills the viewport).
// On a desktop browser it keeps the app from stretching edge-to-edge into an
// unusably wide layout, centering it as a phone-width card instead.
const styles = StyleSheet.create({
  tabLabel: { alignItems: 'center' },
  tabLabelText: { fontSize: 11 },
  tabDot: { height: 5, width: 5, borderRadius: 3, marginTop: 3, backgroundColor: 'transparent' },
  webOuter: (Platform.OS === 'web'
    ? { flex: 1, alignItems: 'center', backgroundColor: colors.slate200, minHeight: '100vh' }
    : { flex: 1 }) as object,
  webInner: (Platform.OS === 'web'
    ? { flex: 1, width: '100%', maxWidth: 480, backgroundColor: colors.white, boxShadow: '0 0 24px rgba(0,0,0,0.08)' }
    : { flex: 1 }) as object,
  lockScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
    paddingHorizontal: 32,
  },
  lockLogo: {
    height: 384,
    width: 384,
    maxWidth: '100%',
    marginBottom: 12,
  },
  lockTitle: { fontSize: 20, fontWeight: '700', color: colors.ink, marginBottom: 6 },
  lockSubtitle: { fontSize: 14, color: colors.slate500, textAlign: 'center', marginBottom: 24 },
  unlockButton: { backgroundColor: colors.accent, paddingHorizontal: 32, paddingVertical: 12, borderRadius: 10 },
  unlockButtonText: { color: colors.white, fontSize: 15, fontWeight: '600' },
});
