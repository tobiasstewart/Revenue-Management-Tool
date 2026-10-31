import { createBrowserClient, createServerClient } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

/**
 * Browser client — use in Client Components.
 * Reads env vars lazily so scripts can inject them via dotenv first.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

/**
 * Server client — use in Server Components, Route Handlers, and Server Actions.
 * The cookie write is wrapped in try/catch because Server Components receive
 * read-only cookies; the middleware refreshes the session on every request,
 * so the missing write doesn't affect correctness.
 */
export async function createServerSupabaseClient() {
  const { cookies } = await import('next/headers')
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Called from a Server Component — cookies are read-only here.
          }
        },
      },
    }
  )
}

/**
 * Admin client — uses the service-role key and bypasses RLS.
 * Never expose SUPABASE_SERVICE_ROLE_KEY to the browser. Firm scoping is
 * MANUAL on this client: every query must filter by firm itself.
 */
export function createAdminClient() {
  if (typeof window !== 'undefined') {
    throw new Error('createAdminClient() must never be called in the browser')
  }
  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
