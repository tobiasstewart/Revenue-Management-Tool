import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabaseClient } from '@/lib/supabase'

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

/**
 * Password sign-in goes through the server (not signInWithPassword in the
 * browser) so a server-side throttle and MFA step can be added here later
 * without changing the login page.
 */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Enter your email and password' }, { status: 400 })
  }

  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.auth.signInWithPassword(parsed.data)
  if (error) {
    return NextResponse.json({ error: 'Incorrect email or password' }, { status: 401 })
  }
  return NextResponse.json({ ok: true })
}
