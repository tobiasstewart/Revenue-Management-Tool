import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase'
import Sidebar from '@/components/layout/Sidebar'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('full_name, role')
    .eq('id', user.id)
    .maybeSingle()

  return (
    <div className="flex min-h-screen" style={{ backgroundColor: '#EEF2F7' }}>
      <Sidebar userEmail={user.email ?? ''} userName={profile?.full_name ?? null} />
      <main className="flex-1 overflow-auto min-w-0">
        <div className="p-6">{children}</div>
      </main>
    </div>
  )
}
