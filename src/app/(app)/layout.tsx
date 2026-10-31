import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase'
import Sidebar from '@/components/layout/Sidebar'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // RLS shows a user their own row only if they belong to an active firm
  // membership; no row = signed in but never invited (or disabled).
  const { data: profile } = await supabase
    .from('users')
    .select('full_name, role')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-page">
        <div className="bg-white rounded-lg shadow p-8 max-w-md text-center space-y-3">
          <h1 className="text-lg font-semibold text-brand">Account not set up</h1>
          <p className="text-sm text-gray-600">
            You&apos;re signed in as {user.email}, but this login isn&apos;t linked to a firm yet. Ask an administrator to invite you.
          </p>
          <form action="/api/auth/logout" method="post">
            <button type="submit" className="text-sm text-accent underline">Sign out</button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-page">
      <Sidebar userEmail={user.email ?? ''} userName={profile.full_name ?? null} />
      <main className="flex-1 overflow-auto min-w-0">
        <div className="p-6 max-w-[1400px]">{children}</div>
      </main>
    </div>
  )
}
