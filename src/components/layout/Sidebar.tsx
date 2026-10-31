'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { clsx } from 'clsx'
import { BarChart3, Building2, FileSpreadsheet, LayoutDashboard, ListChecks, LogOut, Settings, UserRound, Users } from 'lucide-react'

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/statements', label: 'Statements', icon: FileSpreadsheet },
  { href: '/review', label: 'Review queue', icon: ListChecks },
  { href: '/reports', label: 'Reports', icon: BarChart3 },
  { href: '/households', label: 'Households', icon: Users },
  { href: '/providers', label: 'Providers', icon: Building2 },
  { href: '/advisers', label: 'Advisers', icon: UserRound },
  { href: '/settings', label: 'Settings', icon: Settings },
]

export default function Sidebar({ userEmail, userName }: { userEmail: string; userName: string | null }) {
  const pathname = usePathname()
  return (
    <aside className="w-56 shrink-0 flex flex-col text-white bg-brand min-h-screen">
      <div className="px-5 py-5">
        <div className="font-semibold text-lg leading-tight">Revenue Management</div>
        <div className="text-xs opacity-75">Hartmann Planning</div>
      </div>
      <nav className="flex-1 px-3 space-y-0.5">
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={clsx(
              'flex items-center gap-2 rounded px-3 py-2 text-sm',
              pathname === href || pathname.startsWith(href + '/') ? 'bg-white/20 font-medium' : 'hover:bg-white/10'
            )}
          >
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
