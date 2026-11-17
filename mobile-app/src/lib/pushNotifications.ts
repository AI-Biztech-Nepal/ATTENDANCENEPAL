import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { supabase } from './supabase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/** The token this phone registered for the current login, kept so signing out can remove it. */
let registeredToken: string | null = null;

/** Requests notification permission, gets this device's Expo push token and
 * registers it for whoever is logged in — an employee, HR, or an owner with
 * no employee record (HR alerts such as a contract ending go to those two).
 * Call once the profile is known (see AuthContext.tsx) — safe to call again on
 * every login, it replaces the login's row.
 *
 * Physical device + a real EAS projectId are both required for a token to
 * actually be issued (simulators and a placeholder projectId silently
 * no-op instead of throwing, so this never blocks the rest of the app). */
export async function registerForPushNotifications(employeeId: string | null): Promise<void> {
  if (!Device.isDevice) return;

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId || projectId === 'REPLACE_WITH_EAS_PROJECT_ID') return;

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const pushToken = await Notifications.getExpoPushTokenAsync({ projectId });
  registeredToken = pushToken.data;

  const { error } = await supabase.rpc('register_push_token', { p_token: pushToken.data });
  // Until 20261104120000_hr_alert_push.sql has been run the function doesn't exist; an employee can
  // still register the old way, so their Week-off pushes keep working in the meantime.
  if (error && employeeId) {
    await supabase.from('push_tokens').upsert(
      { employee_id: employeeId, expo_push_token: pushToken.data, updated_at: new Date().toISOString() },
      { onConflict: 'employee_id' }
    );
  }
}

/** Signs out, first telling the server to stop sending this phone anything for this login — otherwise a
 * signed-out phone keeps showing its last user's alerts. Never blocks signing out. */
export async function signOutAndUnregisterPush(): Promise<void> {
  const token = registeredToken;
  registeredToken = null;
  if (token) {
    try {
      await supabase.rpc('unregister_push_token', { p_token: token });
    } catch {
      // Offline or not set up — signing out matters more.
    }
  }
  await supabase.auth.signOut();
}
