import React, { useState } from 'react';
import {
  View,
  TextInput,
  TextInputProps,
  TouchableOpacity,
  Text,
  Image,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Linking,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { API_BASE } from '../lib/accountsApi';
import { colors } from '../theme';
import { EyeIcon, EyeOffIcon } from '../components/icons';

// Sign in, sign up and forgot password share this one screen (swapped in
// place) since the signed-out app has no navigator — mirrors admin-web's
// /login, /register and /forgot-password pages.
type Mode = 'login' | 'register' | 'forgot';

const TITLES: Record<Mode, string> = {
  login: 'Attendance Nepal',
  register: 'Sign Up',
  forgot: 'Reset Password',
};

export default function LoginScreen() {
  const [mode, setMode] = useState<Mode>('login');

  return (
    <KeyboardAvoidingView style={styles.outer} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          {/* eslint-disable-next-line @typescript-eslint/no-require-imports */}
          <Image source={require('../../assets/icon.png')} style={styles.logo} resizeMode="contain" />
          <Text style={styles.title}>{TITLES[mode]}</Text>
          {mode === 'login' && <LoginForm onMode={setMode} />}
          {mode === 'register' && <RegisterForm onMode={setMode} />}
          {mode === 'forgot' && <ForgotForm onMode={setMode} />}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

type FormProps = { onMode: (mode: Mode) => void };

function LoginForm({ onMode }: FormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleLogin() {
    setError(null);
    setSubmitting(true);
    // Trimmed because Android keyboards append a space after picking an
    // email suggestion, and Supabase rejects the address with it attached.
    const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setSubmitting(false);
    if (authError) setError(authError.message);
  }

  return (
    <>
      <EmailField value={email} onChangeText={setEmail} />
      <PasswordField label="Password" value={password} onChangeText={setPassword} />
      {error && <Text style={styles.error}>{error}</Text>}
      <SubmitButton label={submitting ? 'Signing in…' : 'Sign in'} onPress={handleLogin} disabled={submitting} />
      <View style={styles.linksRow}>
        <TouchableOpacity onPress={() => onMode('register')}>
          <Text style={styles.linkAccent}>Create account</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => onMode('forgot')}>
          <Text style={styles.linkMuted}>Forgot password?</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}

function RegisterForm({ onMode }: FormProps) {
  const [companyName, setCompanyName] = useState('');
  const [location, setLocation] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [portalUrl, setPortalUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleRegister() {
    setError(null);
    setPortalUrl(null);
    if (!companyName.trim() || !fullName.trim() || !email.trim()) {
      setError('Company name, full name and email are required.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setSubmitting(true);
    // Same /api/register the web sign-up uses: the account is created
    // already-confirmed (no confirmation email), so sign straight in after.
    try {
      const res = await fetch(`${API_BASE}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName, companyName, location, email: email.trim(), password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSubmitting(false);
        setError(body.error ?? 'Could not create the account.');
        // 410: sign-up moved to the portal.
        if (res.status === 410) setPortalUrl(body.portalUrl ?? null);
        return;
      }
    } catch {
      setSubmitting(false);
      setError('Could not reach the server. Check your internet connection.');
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setSubmitting(false);
    if (signInError) setError(signInError.message);
  }

  return (
    <>
      <Field label="Company name" value={companyName} onChangeText={setCompanyName} />
      <Field label="Location" value={location} onChangeText={setLocation} />
      <Field label="Full name" value={fullName} onChangeText={setFullName} autoCapitalize="words" />
      <EmailField value={email} onChangeText={setEmail} />
      <PasswordField label="Password" value={password} onChangeText={setPassword} />
      <PasswordField label="Confirm password" value={confirmPassword} onChangeText={setConfirmPassword} />
      {error && <Text style={styles.error}>{error}</Text>}
      {portalUrl && (
        <TouchableOpacity onPress={() => Linking.openURL(portalUrl)}>
          <Text style={styles.linkAccent}>Go to portal sign-up</Text>
        </TouchableOpacity>
      )}
      <SubmitButton
        label={submitting ? 'Creating account…' : 'Create account'}
        onPress={handleRegister}
        disabled={submitting}
      />
      <View style={styles.linksCenter}>
        <Text style={styles.linkMuted}>Already have an account? </Text>
        <TouchableOpacity onPress={() => onMode('login')}>
          <Text style={styles.linkAccent}>Sign in</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}

function ForgotForm({ onMode }: FormProps) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleReset() {
    setError(null);
    setSubmitting(true);
    // The emailed link opens admin-web's reset page in the phone's browser —
    // the new password set there works for the app too.
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${API_BASE}/reset-password`,
    });
    setSubmitting(false);
    if (resetError) {
      setError(resetError.message);
      return;
    }
    setSent(true);
  }

  return (
    <>
      {sent ? (
        <Text style={styles.hint}>
          If an account exists for <Text style={styles.hintStrong}>{email.trim()}</Text>, a password reset link has been
          sent. Follow it to set a new password.
        </Text>
      ) : (
        <>
          <Text style={styles.hint}>Enter your email and we'll send you a reset link.</Text>
          <EmailField value={email} onChangeText={setEmail} />
          {error && <Text style={styles.error}>{error}</Text>}
          <SubmitButton label={submitting ? 'Sending…' : 'Send reset link'} onPress={handleReset} disabled={submitting} />
        </>
      )}
      <View style={styles.linksCenter}>
        <TouchableOpacity onPress={() => onMode('login')}>
          <Text style={styles.linkAccent}>Back to sign in</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}

function Field({ label, ...props }: { label: string } & TextInputProps) {
  return (
    <>
      <Text style={styles.label}>{label}</Text>
      <TextInput style={styles.input} placeholderTextColor={colors.slate400} {...props} />
    </>
  );
}

function EmailField(props: Pick<TextInputProps, 'value' | 'onChangeText'>) {
  return (
    <Field
      label="Email"
      autoCapitalize="none"
      autoCorrect={false}
      autoComplete="email"
      keyboardType="email-address"
      placeholder="you@company.com"
      {...props}
    />
  );
}

function PasswordField({ label, ...props }: { label: string } & Pick<TextInputProps, 'value' | 'onChangeText'>) {
  const [show, setShow] = useState(false);
  return (
    <>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.passwordWrap}>
        <TextInput
          style={[styles.input, styles.passwordInput]}
          secureTextEntry={!show}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="••••••••"
          placeholderTextColor={colors.slate400}
          {...props}
        />
        <TouchableOpacity
          style={styles.eyeButton}
          onPress={() => setShow(v => !v)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={show ? 'Hide password' : 'Show password'}
        >
          {show ? <EyeOffIcon color={colors.slate400} /> : <EyeIcon color={colors.slate400} />}
        </TouchableOpacity>
      </View>
    </>
  );
}

function SubmitButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled: boolean }) {
  return (
    <TouchableOpacity style={[styles.button, disabled && styles.buttonDisabled]} onPress={onPress} disabled={disabled}>
      <Text style={styles.buttonText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  outer: { flex: 1, backgroundColor: colors.slate50 },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  card: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 28,
    borderWidth: 1,
    borderColor: colors.slate200,
    alignItems: 'center',
  },
  logo: { height: 96, width: 96, marginBottom: 10 },
  title: { fontSize: 19, fontWeight: '700', color: colors.ink, marginBottom: 24 },
  label: { alignSelf: 'flex-start', fontSize: 13, fontWeight: '600', color: colors.ink, marginBottom: 6 },
  input: {
    width: '100%',
    borderWidth: 1,
    borderColor: colors.slate200,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    marginBottom: 16,
    fontSize: 14,
    color: colors.ink,
  },
  passwordWrap: { width: '100%', marginBottom: 16, justifyContent: 'center' },
  passwordInput: { marginBottom: 0, paddingRight: 46 },
  eyeButton: { position: 'absolute', right: 12, padding: 4 },
  error: { color: colors.criticalText, fontSize: 13, marginBottom: 12, alignSelf: 'flex-start' },
  hint: { alignSelf: 'flex-start', fontSize: 13, color: colors.slate500, marginBottom: 16, lineHeight: 19 },
  hintStrong: { fontWeight: '600', color: colors.ink },
  button: { width: '100%', backgroundColor: colors.accent, borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: colors.white, fontSize: 15, fontWeight: '700' },
  linksRow: { width: '100%', flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 },
  linksCenter: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 16 },
  linkAccent: { fontSize: 13, fontWeight: '600', color: colors.accent },
  linkMuted: { fontSize: 13, color: colors.slate500 },
});
