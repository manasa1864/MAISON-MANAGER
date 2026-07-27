import { useState } from 'react'
import { signIn, signUp } from '../lib/api'
import { Button, C, Field, mono, sans, serif } from './ui'

export default function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setError('')
    setNotice('')
    if (!email.trim() || !password) {
      setError('Email and password are both required.')
      return
    }
    setBusy(true)
    try {
      if (mode === 'signup') {
        const { hasSession } = await signUp(email.trim(), password, name.trim() || email.split('@')[0])
        if (hasSession) {
          onSignedIn()
        } else {
          setNotice('Account created — check your email to confirm it, then sign in below.')
          setMode('signin')
        }
      } else {
        await signIn(email.trim(), password)
        onSignedIn()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background:
          'radial-gradient(ellipse at 30% 20%, rgba(59,44,32,0.35) 0%, transparent 60%), #14130A',
        padding: 24,
      }}
    >
      <div
        className="glass"
        style={{ width: '100%', maxWidth: 400, borderRadius: 20, padding: 36 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: `linear-gradient(135deg, ${C.accent}, ${C.accentDeep})`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 17,
              fontWeight: 700,
              color: C.cream,
              fontFamily: serif,
            }}
          >
            M
          </div>
          <div>
            <div style={{ fontFamily: serif, fontSize: 19, color: C.cream }}>Maison</div>
            <div style={{ fontSize: 10, color: C.accent, fontFamily: mono, letterSpacing: '0.1em' }}>
              RESTAURANT OS
            </div>
          </div>
        </div>

        <h1 style={{ fontFamily: serif, fontSize: 24, color: C.cream, margin: '0 0 6px', fontWeight: 400 }}>
          {mode === 'signin' ? 'Manager sign in' : 'Create a manager account'}
        </h1>
        <p style={{ color: C.stone, fontSize: 13, margin: '0 0 24px', lineHeight: 1.6 }}>
          {mode === 'signin'
            ? 'Same database as the guest app — sign in to manage the floor.'
            : 'Create an account to start managing the floor.'}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {mode === 'signup' && (
            <Field label="Name" value={name} onChange={setName} placeholder="Marco Rossi" />
          )}
          <Field label="Email" value={email} onChange={setEmail} type="email" placeholder="you@example.com" />
          <Field label="Password" value={password} onChange={setPassword} type="password" placeholder="••••••••" />
        </div>

        {error && (
          <p style={{ color: C.error, fontSize: 12, marginTop: 16, marginBottom: 0, lineHeight: 1.6 }}>
            {error}
          </p>
        )}
        {notice && (
          <p
            style={{
              color: C.accent,
              fontSize: 11,
              marginTop: 16,
              marginBottom: 0,
              lineHeight: 1.7,
              fontFamily: mono,
              wordBreak: 'break-word',
            }}
          >
            {notice}
          </p>
        )}

        <Button onClick={submit} disabled={busy} style={{ width: '100%', marginTop: 22, padding: '11px 0' }}>
          {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </Button>

        <button
          onClick={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin')
            setError('')
            setNotice('')
          }}
          style={{
            background: 'none',
            border: 'none',
            color: C.stone,
            fontSize: 12,
            fontFamily: sans,
            cursor: 'pointer',
            marginTop: 16,
            width: '100%',
          }}
        >
          {mode === 'signin' ? 'Need an account? Sign up' : 'Already have an account? Sign in'}
        </button>
      </div>
    </div>
  )
}
