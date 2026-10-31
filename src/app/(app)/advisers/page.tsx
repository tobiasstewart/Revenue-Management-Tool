'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { errorMessage } from '@/lib/data'
import type { Adviser, FirmSettings } from '@/lib/types'
import { Button, Card, Empty, ErrorBanner, Loading, PageHeader, inputCls, tdCls, thCls } from '@/components/ui'

export default function AdvisersPage() {
  const supabase = useMemo(() => createClient(), [])
  const [advisers, setAdvisers] = useState<Adviser[] | null>(null)
  const [settings, setSettings] = useState<FirmSettings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')

  useEffect(() => {
    Promise.all([
      supabase.from('advisers').select('*').order('name'),
      supabase.from('firm_settings').select('*').maybeSingle(),
    ]).then(([a, s]) => {
      if (a.error) return setError(a.error.message)
      setAdvisers(a.data)
      setSettings(s.data)
    })
  }, [supabase])

  const adminOnly = (msg: string) => (/row-level security|permission/i.test(msg) ? 'Only firm admins can change advisers.' : msg)

  async function add() {
    setError(null)
    const { data, error } = await supabase.from('advisers').insert({ name: name.trim(), email: email.trim() || null }).select('*').single()
    if (error) return setError(error.code === '23505' ? 'An adviser with that name already exists' : adminOnly(error.message))
    setAdvisers((a) => [...(a ?? []), data].sort((x, y) => x.name.localeCompare(y.name)))
    setName('')
    setEmail('')
  }

  async function update(id: string, patch: Partial<Adviser>) {
    setError(null)
    const { data, error } = await supabase.from('advisers').update(patch).eq('id', id).select('*').single()
    if (error) return setError(adminOnly(errorMessage(error)))
    setAdvisers((a) => a!.map((x) => (x.id === id ? data : x)))
  }

  const defaultPct = settings ? Number(settings.upfront_adviser_pct) : 60

  return (
    <div className="space-y-5">
      <PageHeader title="Advisers" sub={`Advisers keep ${defaultPct}% of upfront revenue by default (set in Settings). Ongoing revenue goes to the business.`} />
      <ErrorBanner error={error} />
      <Card title="Add adviser">
        <div className="flex flex-wrap gap-2">
          <input className={`${inputCls} w-56`} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className={`${inputCls} w-64`} placeholder="Email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button disabled={!name.trim()} onClick={add}>Add</Button>
        </div>
      </Card>
      <Card title="Advisers">
        {!advisers ? <Loading /> : !advisers.length ? <Empty>No advisers yet.</Empty> : (
          <table className="min-w-full">
            <thead><tr>
              <th className={thCls}>Name</th><th className={thCls}>Email</th><th className={thCls}>Upfront split</th><th className={thCls}>Status</th>
            </tr></thead>
            <tbody>
              {advisers.map((a, i) => (
                <tr key={a.id} className={i % 2 ? 'bg-row' : 'bg-white'}>
                  <td className={tdCls}><input className={`${inputCls} w-48`} defaultValue={a.name} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== a.name && update(a.id, { name: e.target.value.trim() })} /></td>
                  <td className={tdCls}><input className={`${inputCls} w-56`} defaultValue={a.email ?? ''} onBlur={(e) => (e.target.value.trim() || null) !== a.email && update(a.id, { email: e.target.value.trim() || null })} /></td>
                  <td className={tdCls}>
                    <div className="flex items-center gap-1">
                      <input
                        className={`${inputCls} w-20 text-right`}
                        placeholder={String(defaultPct)}
                        defaultValue={a.upfront_split_pct === null ? '' : String(Number(a.upfront_split_pct))}
                        onBlur={(e) => {
                          const v = e.target.value.trim()
                          const pct = v === '' ? null : Number(v)
                          if (pct !== null && (Number.isNaN(pct) || pct < 0 || pct > 100)) return setError('Split must be between 0 and 100')
                          if (pct !== (a.upfront_split_pct === null ? null : Number(a.upfront_split_pct))) update(a.id, { upfront_split_pct: pct })
                        }}
                      />
                      <span className="text-sm text-gray-500">% {a.upfront_split_pct === null && '(firm default)'}</span>
                    </div>
                  </td>
                  <td className={tdCls}>
                    <select className={inputCls} value={a.is_active ? 'a' : 'i'} onChange={(e) => update(a.id, { is_active: e.target.value === 'a' })}>
                      <option value="a">Active</option><option value="i">Inactive</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-xs text-gray-500 mt-3">A change to a split applies to lines matched or re-classified from now on; lines already matched keep the split they were matched under.</p>
      </Card>
    </div>
  )
}
