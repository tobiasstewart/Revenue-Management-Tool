import { describe, it, expect } from 'vitest'
import { buildCsp, makeNonce } from '../csp'

describe('buildCsp', () => {
  it('pins scripts to the nonce with no unsafe-inline in production', () => {
    const csp = buildCsp('abc', { supabaseUrl: 'https://x.supabase.co' })
    expect(csp).toContain(`script-src 'self' 'nonce-abc' 'strict-dynamic'`)
    expect(csp).not.toContain(`'unsafe-eval'`)
    expect(csp).toContain('connect-src \'self\' https://x.supabase.co wss://x.supabase.co')
    expect(csp).toContain(`frame-ancestors 'none'`)
  })

  it('allows eval + websockets in dev for React Refresh', () => {
    const csp = buildCsp('abc', { isDev: true })
    expect(csp).toContain(`'unsafe-eval'`)
    expect(csp).toContain('ws:')
  })
})

describe('makeNonce', () => {
  it('returns a fresh base64 value each call', () => {
    const a = makeNonce()
    expect(a).toMatch(/^[A-Za-z0-9+/]+=*$/)
    expect(makeNonce()).not.toBe(a)
  })
})
