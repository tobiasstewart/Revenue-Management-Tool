'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    setLoading(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Sign-in failed')
      return
    }
    const next = searchParams.get('next')
    // Only follow same-site relative paths
    router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard')
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="w-full max-w-sm bg-white rounded-lg shadow p-8 space-y-4">
      <h1 className="text-xl font-semibold" style={{ color: '#0D8585' }}>Revenue Management Tool</h1>
      <label className="block text-sm">
        Email
        <input
          type="email" required autoComplete="email" value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full border rounded px-3 py-2"
        />
      </label>
      <label className="block text-sm">
        Password
        <input
          type="password" required autoComplete="current-password" value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full border rounded px-3 py-2"
        />
      </label>
      {error && <p className="text-sm" style={{ color: '#DC2626' }}>{error}</p>}
      <button
        type="submit" disabled={loading}
        className="w-full rounded py-2 text-white font-medium disabled:opacity-50"
        style={{ backgroundColor: '#0D8585' }}
      >
        {loading ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
