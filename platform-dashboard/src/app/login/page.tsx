'use client'

import { useActionState } from 'react'
import { login } from './actions'

const initialState: { error: string } | undefined = undefined

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(async (_: typeof initialState, formData: FormData) => {
    const result = await login(formData)
    return result ?? undefined
  }, initialState)

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <form action={formAction} className="panel" style={{ padding: 32, width: 360 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Fees101 Platform</h1>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 24 }}>Founder dashboard — sign in.</p>

        <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>Email</label>
        <input
          name="email"
          type="email"
          required
          style={{ width: '100%', padding: '8px 10px', marginBottom: 16, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--ink)' }}
        />

        <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>Password</label>
        <input
          name="password"
          type="password"
          required
          style={{ width: '100%', padding: '8px 10px', marginBottom: 20, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--ink)' }}
        />

        {state?.error && <p style={{ color: 'var(--bad)', fontSize: 13, marginBottom: 16 }}>{state.error}</p>}

        <button type="submit" disabled={pending} className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '10px 0' }}>
          {pending ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
