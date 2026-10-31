import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient()
  await supabase.auth.signOut()
  return NextResponse.redirect(new URL('/login', request.url), { status: 303 })
}
