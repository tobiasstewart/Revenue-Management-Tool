'use client'

import { useEffect, useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase'
import { dateLabel, todayIso } from '@/lib/periods'
import type { FirmSettings, Shareholder } from '@/lib/types'
import { Button, Card, Empty, ErrorBanner, Field, Loading, Notice, PageHeader, inputCls, tdCls, thCls } from '@/components/ui'

interface UserRow { id: string; email: string; full_name: string | null; role: string; is_active: boolean }

export default function SettingsPage() {
  const supabase = useMemo(() => createClient(), [])
  const [settings, setSettings] = useState<FirmSettings | null>(null)
  const [form, setForm] = useState({ upfront: '', oneOff: '' })
  const [holders, setHolders] = useState<Shareholder[]>([])
  const [users, setUsers] = useState<UserRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [draft, setDraft] = useState({ name: '', share_pct: '', effective_from: todayIso() })

  useEffect(() => {
    Promise.all([
      supabase.from('firm_settings').select('*').maybeSingle(),
      supabase.from('shareholders').select('*').order('effective_from'),
      supabase.from('users').select('id, email, full_name, role, is_active').order('email'),
    ]).then(([s, h, u]) => {
      if (s.error) return setError(s.error.message)
      setSettings(s.data)
      if (s.data) setForm({ upfront: String(Number(s.data.upfront_adviser_pct)), oneOff: String(Number(s.data.one_off_adviser_pct)) })
      setHolders(h.data ?? [])
      setUsers(u.data ?? [])
    })
  }, [supabase])

  const adminOnly = (msg: string) => (/row-level security|permission|0 rows|JSON object/i.test(msg) ? 'Only firm admins can change these settings.' : msg)

  async function saveSplits() {
    setError(null)
    const upfront = Number(form.upfront)
    const oneOff = Number(form.oneOff)
    if ([upfront, oneOff].some((v) => Number.isNaN(v) || v < 0 || v > 100)) return setError('Splits must be between 0 and 100')
    const { data, error } = await supabase.from('firm_settings')
      .update({ upfront_adviser_pct: upfront, one_off_adviser_pct: oneOff, updated_at: new Date().toISOString() })
      .eq('firm_id', settings!.firm_id).select('*').single()
    if (error) return setError(adminOnly(error.message))
    setSettings(data)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function addHolder() {
    setError(null)
    const pct = Number(draft.share_pct)
    if (Number.isNaN(pct) || pct <= 0 || pct > 100) return setError('Shareholding must be between 0 and 100')
    const { data, error } = await supabase.from('shareholders')
      .insert({ name: draft.name.trim(), share_pct: pct, effective_from: draft.effective_from }).select('*').single()
    if (error) return setError(adminOnly(error.message))
    setHolders((h) => [...h, data])
    setDraft({ ...draft, name: '', share_pct: '' })
  }

  async function updateHolder(id: string, patch: Partial<Shareholder>) {
    setError(null)
    const { data, error } = await supabase.from('shareholders').update(patch).eq('id', id).select('*').single()
    if (error) return setError(adminOnly(error.message))
    setHolders((h) => h.map((x) => (x.id === id ? data : x)))
  }

  async function removeHolder(id: string) {
    if (!confirm('Delete this shareholding? To record a change in holdings, set an end date instead so past periods stay correct.')) return
    const { error } = await supabase.from('shareholders').delete().eq('id', id)
    if (error) return setError(adminOnly(error.message))
    setHolders((h) => h.filter((x) => x.id !== id))
  }

  if (!settings) return <><ErrorBanner error={error} /><Loading /></>

  const today = todayIso()
  const currentPct = holders
    .filter((h) => h.effective_from <= today && (!h.effective_to || h.effective_to >= today))
    .reduce((a, h) => a + Number(h.share_pct), 0)

  return (
    <div className="space-y-5 max-w-5xl">
      <PageHeader title="Settings" />
      <ErrorBanner error={error} />

      <Card title="Adviser splits">
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Upfront — adviser keeps (%)" help="Upfront fees and upfront commission. An adviser can have their own figure.">
            <input className={`${inputCls} w-full`} value={form.upfront} onChange={(e) => setForm({ ...form, upfront: e.target.value })} />
          </Field>
          <Field label="One-off — adviser keeps (%)" help="One-off fees. Set to 0 to treat them like ongoing revenue.">
            <input className={`${inputCls} w-full`} value={form.oneOff} onChange={(e) => setForm({ ...form, oneOff: e.target.value })} />
          </Field>
          <Field label="Ongoing — adviser keeps" help="Ongoing fees, renewal and trail commission go entirely to the business.">
            <div className="py-1.5 text-sm">0%</div>
          </Field>
        </div>
        <p className="text-xs text-gray-500 mt-2">Splits are applied to the ex-GST amount. A change applies to lines matched or re-classified from now on.</p>
        <div className="flex justify-end items-center gap-2 mt-3">
          {saved && <span className="text-sm text-brand">Saved</span>}
          <Button onClick={saveSplits}>Save splits</Button>
        </div>
      </Card>

      <Card title="Shareholders">
        <p className="text-sm text-gray-600 mb-3">The business share of revenue — all ongoing revenue plus the business&apos;s part of upfronts — is reported by shareholding. To change holdings, end-date the old rows and add new ones, so earlier periods keep the holdings in effect then.</p>
        {holders.length > 0 && Math.abs(currentPct - 100) > 0.0001 && (
          <div className="mb-3"><Notice tone="warn">Today&apos;s shareholdings total {currentPct}%, not 100%.</Notice></div>
        )}
        {!holders.length ? <Empty>No shareholders yet.</Empty> : (
          <table className="min-w-full mb-3">
            <thead><tr><th className={thCls}>Name</th><th className={thCls}>Share</th><th className={thCls}>From</th><th className={thCls}>Until</th><th className={thCls}></th></tr></thead>
            <tbody>
              {holders.map((h, i) => (
                <tr key={h.id} className={i % 2 ? 'bg-row' : 'bg-white'}>
                  <td className={tdCls}>{h.name}</td>
                  <td className={tdCls}>{Number(h.share_pct)}%</td>
                  <td className={tdCls}>{h.effective_from <= '2000-01-01' ? 'Always' : dateLabel(h.effective_from)}</td>
                  <td className={tdCls}>
                    <input type="date" className={inputCls} defaultValue={h.effective_to ?? ''} onBlur={(e) => (e.target.value || null) !== h.effective_to && updateHolder(h.id, { effective_to: e.target.value || null })} />
                  </td>
                  <td className={tdCls + ' text-right'}><button type="button" className="text-gray-400 hover:text-negative" onClick={() => removeHolder(h.id)}><Trash2 size={15} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="flex flex-wrap gap-2 items-end">
          <input className={`${inputCls} w-56`} placeholder="Shareholder name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <input className={`${inputCls} w-24 text-right`} placeholder="%" value={draft.share_pct} onChange={(e) => setDraft({ ...draft, share_pct: e.target.value })} />
          <label className="text-sm text-gray-600 flex items-center gap-1">from <input type="date" className={inputCls} value={draft.effective_from} onChange={(e) => setDraft({ ...draft, effective_from: e.target.value })} /></label>
          <Button disabled={!draft.name.trim() || !draft.share_pct} onClick={addHolder}>Add</Button>
        </div>
      </Card>

      <Card title="Users">
        <table className="min-w-full">
          <thead><tr><th className={thCls}>Name</th><th className={thCls}>Email</th><th className={thCls}>Role</th></tr></thead>
          <tbody>
            {users.map((u, i) => (
              <tr key={u.id} className={i % 2 ? 'bg-row' : 'bg-white'}>
                <td className={tdCls}>{u.full_name ?? '—'}</td>
                <td className={tdCls}>{u.email}</td>
                <td className={tdCls}>{u.role}{!u.is_active && ' (disabled)'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-gray-500 mt-2">New logins are invite-only and set up by Claude or in Supabase for now — user management in the app is a later step.</p>
      </Card>
    </div>
  )
}
