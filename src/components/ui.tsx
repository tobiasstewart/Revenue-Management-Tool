import Link from 'next/link'
import { clsx } from 'clsx'

export function PageHeader({ title, sub, actions }: { title: string; sub?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
      <div>
        <h1 className="text-2xl font-semibold text-brand">{title}</h1>
        {sub && <p className="text-sm text-gray-600 mt-1">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

export function Card({ title, actions, children, className }: {
  title?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={clsx('bg-white rounded-lg shadow-sm border border-gray-200', className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-gray-100">
          {title && <h2 className="font-semibold text-gray-800">{title}</h2>}
          {actions}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  )
}

export function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'brand' | 'warn' }) {
  return (
    <div className={clsx(
      'rounded-lg border p-4 bg-white',
      tone === 'brand' && 'border-brand bg-brand-light',
      tone === 'warn' && 'border-amber-300 bg-amber-50',
      !tone && 'border-gray-200'
    )}>
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-2xl font-semibold mt-1 tabular-nums">{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  )
}

const BTN = {
  primary: 'bg-brand text-white hover:bg-brand-dark',
  secondary: 'bg-white text-gray-800 border border-gray-300 hover:bg-gray-50',
  danger: 'bg-white text-negative border border-red-300 hover:bg-red-50',
}

export function Button({ variant = 'primary', className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof BTN
}) {
  return (
    <button
      type="button"
      {...props}
      className={clsx(
        'inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed',
        BTN[variant],
        className
      )}
    />
  )
}

export function LinkButton({ href, variant = 'primary', children }: { href: string; variant?: keyof typeof BTN; children: React.ReactNode }) {
  return (
    <Link href={href} className={clsx('inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium', BTN[variant])}>
      {children}
    </Link>
  )
}

export function Badge({ tone = 'grey', children }: { tone?: 'grey' | 'brand' | 'warn' | 'bad' | 'blue'; children: React.ReactNode }) {
  return (
    <span className={clsx(
      'inline-block rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap',
      tone === 'grey' && 'bg-gray-100 text-gray-700',
      tone === 'brand' && 'bg-brand-light text-brand-dark',
      tone === 'warn' && 'bg-amber-100 text-amber-800',
      tone === 'bad' && 'bg-red-100 text-red-700',
      tone === 'blue' && 'bg-blue-100 text-accent'
    )}>
      {children}
    </span>
  )
}

export const inputCls = 'border border-gray-300 rounded px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand/40'
export const thCls = 'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-white bg-brand whitespace-nowrap'
export const thNumCls = thCls + ' text-right'
export const tdCls = 'px-3 py-2 text-sm border-t border-gray-100'
export const tdNumCls = tdCls + ' text-right tabular-nums whitespace-nowrap'

export function Field({ label, children, help }: { label: string; children: React.ReactNode; help?: string }) {
  return (
    <label className="block text-sm">
      <span className="text-gray-700 font-medium">{label}</span>
      <div className="mt-1">{children}</div>
      {help && <span className="block text-xs text-gray-500 mt-1">{help}</span>}
    </label>
  )
}

export function ErrorBanner({ error }: { error: string | null }) {
  if (!error) return null
  return <div className="rounded border border-red-200 bg-red-50 text-negative text-sm px-3 py-2 mb-4">{error}</div>
}

export function Notice({ children, tone = 'info' }: { children: React.ReactNode; tone?: 'info' | 'warn' }) {
  return (
    <div className={clsx(
      'rounded border text-sm px-3 py-2',
      tone === 'info' ? 'border-brand/30 bg-brand-light text-gray-800' : 'border-amber-300 bg-amber-50 text-amber-900'
    )}>
      {children}
    </div>
  )
}

export function Loading() {
  return <p className="text-sm text-gray-500">Loading…</p>
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-gray-500 py-6 text-center">{children}</p>
}
