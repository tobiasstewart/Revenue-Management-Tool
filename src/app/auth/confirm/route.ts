import { NextResponse, type NextRequest } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@/lib/supabase'

/**
 * Supabase email callback (invite / recovery / signup links).
 * Log flow + outcome ONLY — never the URL, token_hash, code or email: an
 * unconsumed link in the logs is an account takeover.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const code = searchParams.get('code')
  const supabase = await createServerSupabaseClient()

  let ok = false
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
    ok = !error
    console.log('[auth/confirm] otp flow', ok ? 'ok' : 'failed')
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    ok = !error
    console.log('[auth/confirm] pkce flow', ok ? 'ok' : 'failed')
  }

  return NextResponse.redirect(new URL(ok ? '/dashboard' : '/login', request.url))
}
