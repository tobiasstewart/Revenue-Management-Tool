import Link from 'next/link'
import { LayoutDashboard, LogOut } from 'lucide-react'

const NAV = [{ href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard }]

export default function Sidebar({ userEmail, userName }: { userEmail: string; userName: string | null }) {
  return (
    <aside className="w-60 shrink-0 flex flex-col text-white" style={{ backgroundColor: '#0D8585' }}>
      <div className="px-5 py-5 font-semibold text-lg">Revenue Management</div>
      <nav className="flex-1 px-3 space-y-1">
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className="flex items-center gap-2 rounded px-3 py-2 hover:bg-white/10">
            <Icon size={16} /> {label}
          </Link>
        ))}
      </nav>
      <div className="px-5 py-4 border-t border-white/20 text-sm">
        <div className="font-medium truncate">{userName ?? userEmail}</div>
        <form action="/api/auth/logout" method="post">
          <button type="submit" className="mt-2 flex items-center gap-2 opacity-80 hover:opacity-100">
            <LogOut size={14} /> Sign out
          </button>
        </form>
      </div>
    </aside>
  )
}
