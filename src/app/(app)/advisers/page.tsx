'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { errorMessage } from '@/lib/data'
import type { Adviser, FirmSettings } from '@/lib/types'
import { Trash2 } from 'lucide-react'
import { Button, Card, Empty, ErrorBanner, Loading, PageHeader, inputCls, tdCls, thCls } from '@/components/ui'

interface CodeRow { id: string; adviser_id: string; provider_id: string | null; kind: 'code' | 'name'; label: string | null; reference: string }

export default function AdvisersPage() {
  const supabase = useMemo(() => createClient(), [])
  const [advisers, setAdvisers] = useState<Adviser[] | null>(null)
  const [settings, setSettings] = useState<FirmSettings | null>(null)
  const [codes, setCodes] = useState<CodeRow[]>([])
  const [providerNames, setProviderNames] = useState<Map<string, string>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')

  useEffect(() => {
    Promise.all([
      supabase.from('advisers').select('*').order('name'),
      supabase.from('firm_settings').select('*').maybeSingle(),
      supabase.from('adviser_references').select('id, adviser_id, provider_id, kind, label, reference').order('created_at'),
      supabase.from('providers').select('id, name'),
    ]).then(([a, s, c, p]) => {
      if (a.error) return setError(a.error.message)
      setAdvisers(a.data)
      setSettings(s.data)
      setCodes(c.data ?? [])
      setProviderNames(new Map((p.data ?? []).map((x: { id: string; name: string }) => [x.id, x.name])))
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

  async function removeCode(id: string) {
    const { error } = await supabase.from('adviser_references').delete().eq('id', id)
    if (error) return setError(error.message)
    setCodes((c) => c.filter((x) => x.id !== id))
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
      <Card title="Statement adviser codes">
        <p className="text-sm text-gray-600 mb-3">How each provider identifies your advisers on its statements. Learnt when you upload a statement or set a line&apos;s adviser; remove one that was mapped by mistake.</p>
        {!codes.length ? <Empty>None yet — they&apos;re added as statements are uploaded.</Empty> : (
          <table className="min-w-full">
            <thead><tr><th className={thCls}>Provider</th><th className={thCls}>On the statement</th><th className={thCls}>Adviser</th><th className={thCls}></th></tr></thead>
            <tbody>
              {codes.map((c, i) => (
                <tr key={c.id} className={i % 2 ? 'bg-row' : 'bg-white'}>
                  <td className={tdCls}>{c.provider_id ? providerNames.get(c.provider_id) ?? '—' : 'Any provider'}</td>
                  <td className={tdCls}>{c.label ?? c.reference}</td>
                  <td className={tdCls}>{advisers?.find((a) => a.id === c.adviser_id)?.name ?? '—'}</td>
                  <td className={tdCls + ' text-right'}><button type="button" className="text-gray-400 hover:text-negative" onClick={() => removeCode(c.id)}><Trash2 size={15} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}
