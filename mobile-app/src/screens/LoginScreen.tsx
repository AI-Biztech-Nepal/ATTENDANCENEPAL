import React, { useState } from 'react';
import { View, TextInput, TouchableOpacity, Text, Image, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { supabase } from '../lib/supabase';
import { colors } from '../theme';
import { EyeIcon, EyeOffIcon } from '../components/icons';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
    <KeyboardAvoidingView style={styles.outer} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.card}>
        {/* eslint-disable-next-line @typescript-eslint/no-require-imports */}
        <Image source={require('../../assets/icon.png')} style={styles.logo} resizeMode="contain" />
        <Text style={styles.title}>Attendance Nepal</Text>

        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          keyboardType="email-address"
          placeholder="you@company.com"
          placeholderTextColor={colors.slate400}
          value={email}
          onChangeText={setEmail}
        />
        <Text style={styles.label}>Password</Text>
        <View style={styles.passwordWrap}>
          <TextInput
            style={[styles.input, styles.passwordInput]}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="••••••••"
            placeholderTextColor={colors.slate400}
            value={password}
            onChangeText={setPassword}
          />
          <TouchableOpacity
            style={styles.eyeButton}
            onPress={() => setShowPassword(v => !v)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? <EyeOffIcon color={colors.slate400} /> : <EyeIcon color={colors.slate400} />}
          </TouchableOpacity>
        </View>
        {error && <Text style={styles.error}>{error}</Text>}
        <TouchableOpacity style={[styles.button, submitting && styles.buttonDisabled]} onPress={handleLogin} disabled={submitting}>
          <Text style={styles.buttonText}>{submitting ? 'Signing in…' : 'Sign in'}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  outer: { flex: 1, backgroundColor: colors.slate50, justifyContent: 'center', padding: 24 },
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
  button: { width: '100%', backgroundColor: colors.accent, borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: colors.white, fontSize: 15, fontWeight: '700' },
});
