import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'

// ── Responsive hook ───────────────────────────────────────────────────────────
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 640)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)')
    const handler = (e) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return isMobile
}

// ── Style factory ─────────────────────────────────────────────────────────────
function makeStyles(isMobile) {
  return {
    wrap: {
      minHeight: '100dvh',
      display: 'flex',
      alignItems: isMobile ? 'flex-start' : 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg,#0f1117 0%,#1a1f2e 100%)',
      padding: isMobile ? '16px 12px 40px' : 16,
      fontFamily: 'Inter,system-ui,sans-serif',
    },
    card: {
      background: '#1e2130',
      border: isMobile ? 'none' : '1px solid #2a2f45',
      borderRadius: isMobile ? 12 : 16,
      padding: isMobile ? '28px 20px 24px' : '40px 36px',
      width: '100%',
      maxWidth: 420,
      boxShadow: isMobile ? '0 8px 32px rgba(0,0,0,.4)' : '0 24px 64px rgba(0,0,0,.45)',
      marginTop: isMobile ? 12 : 0,
    },
    logo: {
      textAlign: 'center',
      marginBottom: isMobile ? 20 : 28,
    },
    logoIcon: { fontSize: isMobile ? 36 : 40, lineHeight: 1 },
    logoTitle: {
      fontSize: isMobile ? 20 : 22,
      fontWeight: 700,
      color: '#f1f5f9',
      margin: '8px 0 4px',
    },
    logoSub: { fontSize: isMobile ? 12 : 13, color: '#64748b', lineHeight: 1.4 },
    tabs: {
      display: 'flex',
      gap: 0,
      marginBottom: isMobile ? 20 : 28,
      background: '#141720',
      borderRadius: 10,
      padding: 3,
    },
    tab: (active) => ({
      flex: 1,
      padding: isMobile ? '10px 0' : '8px 0',
      border: 'none',
      borderRadius: 8,
      cursor: 'pointer',
      fontSize: isMobile ? 15 : 14,
      fontWeight: 600,
      transition: 'all .18s',
      background: active ? '#3b82f6' : 'transparent',
      color:      active ? '#fff'    : '#64748b',
      WebkitTapHighlightColor: 'transparent',
    }),
    label: {
      display: 'block',
      fontSize: 12,
      fontWeight: 600,
      color: '#94a3b8',
      textTransform: 'uppercase',
      letterSpacing: '.06em',
      marginBottom: 6,
    },
    input: {
      width: '100%',
      padding: isMobile ? '14px 14px' : '10px 12px',
      background: '#141720',
      border: '1px solid #2a2f45',
      borderRadius: 8,
      color: '#f1f5f9',
      fontSize: isMobile ? 16 : 14, // 16px prevents iOS zoom on focus
      outline: 'none',
      marginBottom: isMobile ? 14 : 16,
      boxSizing: 'border-box',
      WebkitAppearance: 'none',
    },
    btn: (variant = 'primary') => ({
      width: '100%',
      padding: isMobile ? '14px 0' : '11px 0',
      borderRadius: 8,
      cursor: 'pointer',
      fontSize: isMobile ? 16 : 15,
      fontWeight: 600,
      marginTop: 4,
      transition: 'opacity .15s',
      background:  variant === 'primary' ? '#3b82f6' : '#1e2130',
      color:       variant === 'primary' ? '#fff'    : '#94a3b8',
      borderColor: variant === 'primary' ? 'transparent' : '#2a2f45',
      borderWidth:  1,
      borderStyle: 'solid',
      WebkitTapHighlightColor: 'transparent',
      touchAction: 'manipulation',
    }),
    err: {
      background: '#2d1b1b',
      border: '1px solid #7f1d1d',
      color: '#fca5a5',
      borderRadius: 8,
      padding: isMobile ? '12px 14px' : '10px 12px',
      fontSize: 13,
      marginBottom: isMobile ? 14 : 16,
      lineHeight: 1.5,
    },
    info: {
      background: '#1a2436',
      border: '1px solid #1e40af',
      color: '#93c5fd',
      borderRadius: 8,
      padding: isMobile ? '12px 14px' : '10px 12px',
      fontSize: 13,
      marginBottom: isMobile ? 14 : 16,
      lineHeight: 1.5,
    },
    qr: {
      display: 'block',
      margin: '12px auto 16px',
      borderRadius: 8,
      border: '3px solid #fff',
      width: isMobile ? '100%' : 180,
      maxWidth: 200,
      height: 'auto',
    },
    secret: {
      background: '#141720',
      border: '1px solid #2a2f45',
      borderRadius: 8,
      padding: '8px 12px',
      fontSize: 12,
      color: '#94a3b8',
      wordBreak: 'break-all',
      marginBottom: 16,
      fontFamily: 'monospace',
      lineHeight: 1.6,
    },
    divider: {
      height: 1,
      background: '#2a2f45',
      margin: '20px 0',
    },
    small: {
      fontSize: 12,
      color: '#475569',
      textAlign: 'center',
      marginTop: 16,
      lineHeight: 1.5,
    },
  }
}

// ── Sign-up flow ──────────────────────────────────────────────────────────────
function SignUpForm({ onComplete, isMobile }) {
  const S = makeStyles(isMobile)
  const [step, setStep]     = useState('form')   // 'form' | 'confirm_email' | 'totp_enroll'
  const [email, setEmail]   = useState('')
  const [pass, setPass]     = useState('')
  const [pass2, setPass2]   = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState('')
  // TOTP enrollment state
  const [qrUrl, setQrUrl]   = useState('')
  const [secret, setSecret] = useState('')
  const [factorId, setFactorId] = useState('')
  const [totpCode, setTotpCode] = useState('')

  async function handleSignUp(e) {
    e.preventDefault()
    setError('')
    if (pass !== pass2) { setError('Passwords do not match.'); return }
    if (pass.length < 8)  { setError('Password must be at least 8 characters.'); return }
    setLoading(true)
    try {
      const { data, error: signUpErr } = await supabase.auth.signUp({ email, password: pass })
      if (signUpErr) throw signUpErr

      if (!data.session) {
        setStep('confirm_email')
        setLoading(false)
        return
      }

      await enrollTotp()
    } catch (err) {
      setError(err.message || 'Sign-up failed.')
      setLoading(false)
    }
  }

  async function enrollTotp() {
    try {
      const { data, error: mfaErr } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Authenticator app' })
      if (mfaErr) throw mfaErr
      setQrUrl(data.totp.qr_code)
      setSecret(data.totp.secret)
      setFactorId(data.id)
      setStep('totp_enroll')
    } catch (err) {
      setError(err.message || 'MFA enrollment failed.')
    } finally {
      setLoading(false)
    }
  }

  async function handleVerifyTotp(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { data: challenge, error: cErr } = await supabase.auth.mfa.challenge({ factorId })
      if (cErr) throw cErr
      const { error: vErr } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.id,
        code: totpCode.replace(/\s/g, ''),
      })
      if (vErr) throw vErr
      onComplete('new')
    } catch (err) {
      setError(err.message || 'TOTP verification failed.')
      setLoading(false)
    }
  }

  if (step === 'confirm_email') {
    return (
      <div>
        <div style={S.info}>
          <strong>Check your email</strong><br />
          We sent a confirmation link to <strong>{email}</strong>.<br />
          Click it to verify your account, then come back and sign in.
        </div>
        <p style={{ fontSize: 12, color: '#475569', marginTop: 8, lineHeight: 1.5 }}>
          Once confirmed, sign in and you'll be prompted to set up two-factor authentication.
        </p>
      </div>
    )
  }

  if (step === 'totp_enroll') {
    return (
      <form onSubmit={handleVerifyTotp}>
        <div style={S.info}>
          <strong>Set up two-factor authentication</strong><br />
          Scan the QR code with Google Authenticator, Authy, or any TOTP app, then enter the 6-digit code to confirm.
        </div>
        {qrUrl && <img src={qrUrl} alt="TOTP QR code" style={S.qr} />}
        <div style={S.label}>Or enter this secret manually</div>
        <div style={S.secret}>{secret}</div>
        {error && <div style={S.err}>{error}</div>}
        <label style={S.label}>6-digit code from your authenticator</label>
        <input
          style={S.input}
          type="text"
          inputMode="numeric"
          pattern="[0-9 ]{6,7}"
          maxLength={7}
          placeholder="000000"
          value={totpCode}
          onChange={e => setTotpCode(e.target.value)}
          autoFocus
        />
        <button type="submit" style={S.btn()} disabled={loading}>
          {loading ? 'Verifying…' : 'Verify & finish setup'}
        </button>
        <button type="button" style={{ ...S.btn('secondary'), marginTop: 8 }}
          onClick={() => onComplete('new')} disabled={loading}>
          Skip for now — set up 2FA later in Settings
        </button>
      </form>
    )
  }

  return (
    <form onSubmit={handleSignUp}>
      {error && <div style={S.err}>{error}</div>}
      <label style={S.label}>Email</label>
      <input
        style={S.input} type="email" required autoComplete="email"
        placeholder="you@example.com"
        value={email} onChange={e => setEmail(e.target.value)}
      />
      <label style={S.label}>Password</label>
      <input
        style={S.input} type="password" required autoComplete="new-password"
        placeholder="8+ characters"
        value={pass} onChange={e => setPass(e.target.value)}
      />
      <label style={S.label}>Confirm password</label>
      <input
        style={S.input} type="password" required autoComplete="new-password"
        placeholder="Repeat password"
        value={pass2} onChange={e => setPass2(e.target.value)}
      />
      <button type="submit" style={S.btn()} disabled={loading}>
        {loading ? 'Creating account…' : 'Create account'}
      </button>
      <p style={S.small}>You'll set up two-factor authentication right after.</p>
    </form>
  )
}

// ── Forgot-password flow ──────────────────────────────────────────────────────
// First leg of the recovery flow: collect the user's email and ask Supabase to
// send them a magic link back to this app. The second leg (setting a new
// password) lives in ResetPasswordForm below, triggered when AuthGate detects
// the PASSWORD_RECOVERY auth event.
function ForgotPasswordForm({ onBack, isMobile }) {
  const S = makeStyles(isMobile)
  const [email, setEmail]     = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [sent, setSent]       = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      // redirectTo: the email link drops the user back at this app. The
      // Supabase client picks up the recovery hash automatically (its config
      // already has detectSessionInUrl: true) and fires PASSWORD_RECOVERY,
      // which AuthGate consumes to render ResetPasswordForm.
      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      })
      if (resetErr) throw resetErr
      setSent(true)
    } catch (err) {
      setError(err.message || 'Could not send reset email.')
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <div>
        <div style={S.info}>
          <strong>Check your email</strong><br />
          If an account exists for <strong>{email}</strong>, we just sent a password reset link.<br />
          Click it from any browser or device and you'll be able to set a new password.
        </div>
        <button type="button" style={S.btn('secondary')} onClick={onBack}>
          ← Back to sign in
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit}>
      <div style={S.info}>
        Enter the email tied to your account. We'll send a reset link — click it from any browser or device to set a new password.
      </div>
      {error && <div style={S.err}>{error}</div>}
      <label style={S.label}>Email</label>
      <input
        style={S.input} type="email" required autoComplete="email"
        placeholder="you@example.com"
        value={email} onChange={e => setEmail(e.target.value)}
        autoFocus
      />
      <button type="submit" style={S.btn()} disabled={loading}>
        {loading ? 'Sending…' : 'Send reset link'}
      </button>
      <button type="button" style={{ ...S.btn('secondary'), marginTop: 8 }} onClick={onBack}>
        ← Back to sign in
      </button>
    </form>
  )
}

// ── Set-new-password flow ────────────────────────────────────────────────────
// Rendered when AuthGate detects the PASSWORD_RECOVERY auth event. At this
// point Supabase has put a recovery session in place — supabase.auth.updateUser
// will succeed without any other challenge.
function ResetPasswordForm({ onComplete, isMobile }) {
  const S = makeStyles(isMobile)
  const [pass, setPass]       = useState('')
  const [pass2, setPass2]     = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (pass.length < 8)  { setError('Password must be at least 8 characters.'); return }
    if (pass !== pass2)   { setError('Passwords do not match.'); return }
    setLoading(true)
    try {
      const { error: updErr } = await supabase.auth.updateUser({ password: pass })
      if (updErr) throw updErr
      onComplete()
    } catch (err) {
      setError(err.message || 'Could not update password.')
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div style={S.info}>
        <strong>Set a new password</strong><br />
        Pick something at least 8 characters long. You'll stay signed in after this.
      </div>
      {error && <div style={S.err}>{error}</div>}
      <label style={S.label}>New password</label>
      <input
        style={S.input} type="password" required autoComplete="new-password"
        placeholder="8+ characters"
        value={pass} onChange={e => setPass(e.target.value)}
        autoFocus
      />
      <label style={S.label}>Confirm new password</label>
      <input
        style={S.input} type="password" required autoComplete="new-password"
        placeholder="Repeat password"
        value={pass2} onChange={e => setPass2(e.target.value)}
      />
      <button type="submit" style={S.btn()} disabled={loading}>
        {loading ? 'Updating…' : 'Update password & continue'}
      </button>
    </form>
  )
}

// ── Sign-in flow ──────────────────────────────────────────────────────────────
function SignInForm({ onComplete, onForgotPassword, isMobile }) {
  const S = makeStyles(isMobile)
  const [step, setStep]     = useState('form')   // 'form' | 'totp_challenge'
  const [email, setEmail]   = useState('')
  const [pass, setPass]     = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [factorId, setFactorId] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  async function handleSignIn(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { data, error: signInErr } = await supabase.auth.signInWithPassword({ email, password: pass })
      if (signInErr) throw signInErr

      const { data: aal, error: aalErr } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      if (aalErr) throw aalErr

      if (aal.nextLevel === 'aal2' && aal.nextLevel !== aal.currentLevel) {
        const { data: factors } = await supabase.auth.mfa.listFactors()
        const totp = factors?.totp?.[0]
        if (!totp) throw new Error('No TOTP factor found. Contact support.')
        setFactorId(totp.id)
        setStep('totp_challenge')
      } else {
        onComplete('existing')
      }
    } catch (err) {
      setError(err.message || 'Sign-in failed.')
    } finally {
      setLoading(false)
    }
  }

  async function handleTotpChallenge(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { data: challenge, error: cErr } = await supabase.auth.mfa.challenge({ factorId })
      if (cErr) throw cErr
      const { error: vErr } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.id,
        code: totpCode.replace(/\s/g, ''),
      })
      if (vErr) throw vErr
      onComplete('existing')
    } catch (err) {
      setError(err.message || 'Invalid code.')
      setLoading(false)
    }
  }

  if (step === 'totp_challenge') {
    return (
      <form onSubmit={handleTotpChallenge}>
        <div style={S.info}>Open your authenticator app and enter the current 6-digit code for Golf Strategy Engine.</div>
        {error && <div style={S.err}>{error}</div>}
        <label style={S.label}>Authentication code</label>
        <input
          style={S.input}
          type="text"
          inputMode="numeric"
          pattern="[0-9 ]{6,7}"
          maxLength={7}
          placeholder="000000"
          value={totpCode}
          onChange={e => setTotpCode(e.target.value)}
          autoFocus
        />
        <button type="submit" style={S.btn()} disabled={loading}>
          {loading ? 'Verifying…' : 'Verify'}
        </button>
        <button type="button" style={{ ...S.btn('secondary'), marginTop: 8 }} onClick={() => setStep('form')}>
          ← Back
        </button>
      </form>
    )
  }

  return (
    <form onSubmit={handleSignIn}>
      {error && <div style={S.err}>{error}</div>}
      <label style={S.label}>Email</label>
      <input
        style={S.input} type="email" required autoComplete="email"
        placeholder="you@example.com"
        value={email} onChange={e => setEmail(e.target.value)}
      />
      <label style={S.label}>Password</label>
      <input
        style={S.input} type="password" required autoComplete="current-password"
        placeholder="Your password"
        value={pass} onChange={e => setPass(e.target.value)}
      />
      <button type="submit" style={S.btn()} disabled={loading}>
        {loading ? 'Signing in…' : 'Sign in'}
      </button>
      {onForgotPassword && (
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <button
            type="button"
            onClick={onForgotPassword}
            style={{
              background: 'transparent', border: 'none', color: '#93c5fd',
              fontSize: 13, cursor: 'pointer', padding: 4, textDecoration: 'underline',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            Forgot password?
          </button>
        </div>
      )}
    </form>
  )
}

// ── Root AuthScreen ───────────────────────────────────────────────────────────
// `recoveryMode` is passed by AuthGate when Supabase reports PASSWORD_RECOVERY
// after a user clicks the magic link — that overrides the normal sign-in /
// sign-up flow with the reset form. `onRecoveryComplete` clears the flag in
// AuthGate so the user proceeds straight into the app.
export default function AuthScreen({ onAuth, recoveryMode, onRecoveryComplete }) {
  // 'signin' | 'signup' | 'forgot'. recoveryMode short-circuits everything.
  const [view, setView] = useState('signin')
  const isMobile = useIsMobile()
  const S = makeStyles(isMobile)

  let content
  if (recoveryMode) {
    content = <ResetPasswordForm onComplete={onRecoveryComplete} isMobile={isMobile} />
  } else if (view === 'forgot') {
    content = <ForgotPasswordForm onBack={() => setView('signin')} isMobile={isMobile} />
  } else if (view === 'signup') {
    content = <SignUpForm onComplete={onAuth} isMobile={isMobile} />
  } else {
    content = (
      <SignInForm
        onComplete={onAuth}
        onForgotPassword={() => setView('forgot')}
        isMobile={isMobile}
      />
    )
  }

  // Hide the Sign in / Create account tabs while the user is in a recovery
  // sub-flow — the chrome would just be noise.
  const showTabs = !recoveryMode && view !== 'forgot'

  return (
    <div style={S.wrap}>
      <div style={S.card}>
        <div style={S.logo}>
          <div style={S.logoIcon}>⛳</div>
          <div style={S.logoTitle}>Golf Strategy Engine</div>
          <div style={S.logoSub}>AI-powered caddie brief for competitive golfers</div>
        </div>

        {showTabs && (
          <div style={S.tabs}>
            <button style={S.tab(view === 'signin')} onClick={() => setView('signin')}>Sign in</button>
            <button style={S.tab(view === 'signup')} onClick={() => setView('signup')}>Create account</button>
          </div>
        )}

        {content}

        <div style={S.divider} />
        <p style={S.small}>
          Protected by two-factor authentication.<br />
          Your data is private and device-synced.
        </p>
      </div>
    </div>
  )
}
