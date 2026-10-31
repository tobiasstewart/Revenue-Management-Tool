'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase'
import { LINE_COLUMNS, byId, errorMessage, fetchAll, loadLookups, type Lookups } from '@/lib/data'
import { FEE_TYPE_LABELS } from '@/lib/fee-type'
import { normaliseName, normaliseRef } from '@/lib/matching'
import { fmtMoney } from '@/lib/money'
import { dateLabel, fyLabel, fyOf, monthLabel } from '@/lib/periods'
import { adviserShareCents, groupTotals } from '@/lib/reports'
import type { ClientReferenceRow, Household, RevenueLine } from '@/lib/types'
import { Badge, Button, Card, Empty, ErrorBanner, Field, Loading, Notice, PageHeader, inputCls, tdCls, tdNumCls, thCls, thNumCls } from '@/components/ui'

export default function HouseholdPage() {
  const { id } = useParams<{ id: string }>()
  const supabase = useMemo(() => createClient(), [])
  const [household, setHousehold] = useState<Household | null>(null)
  const [form, setForm] = useState<Household | null>(null)
  const [lookups, setLookups] = useState<Lookups | null>(null)
  const [refs, setRefs] = useState<ClientReferenceRow[]>([])
  const [lines, setLines] = useState<RevenueLine[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [newRef, setNewRef] = useState({ provider_id: '', kind: 'reference' as 'reference' | 'name', value: '' })

  useEffect(() => {
    Promise.all([
      supabase.from('households').select('id, name, adviser_id, is_active, notes').eq('id', id).single(),
      loadLookups(supabase),
      supabase.from('client_references').select('*').eq('household_id', id).order('created_at'),
      fetchAll<RevenueLine>((a, b) => supabase.from('revenue_lines').select(LINE_COLUMNS).eq('household_id', id).order('received_date', { ascending: false }).range(a, b) as never),
    ]).then(([h, l, r, ls]) => {
      if (h.error) throw new Error(h.error.message)
      setHousehold(h.data)
      setForm(h.data)
      setLookups(l)
      setRefs(r.data ?? [])
      setLines(ls)
    }).catch((e) => setError(errorMessage(e)))
  }, [supabase, id])

  if (error && !household) return <ErrorBanner error={error} />
  if (!household || !form || !lookups || !lines) return <Loading />

  const providers = byId(lookups.providers)
  const advisers = byId(lookups.advisers)
  const byFy = [...groupTotals(lines, (l) => String(fyOf(l.received_date))).entries()].sort((a, b) => b[0].localeCompare(a[0]))

  async function save() {
    setError(null)
    const { data, error } = await supabase.from('households')
      .update({ name: form!.name.trim(), adviser_id: form!.adviser_id, is_active: form!.is_active, notes: form!.notes?.trim() || null })
      .eq('id', id).select('id, name, adviser_id, is_active, notes').single()
    if (error) return setError(error.message)
    setHousehold(data)
    setForm(data)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function addRef() {
    const reference = newRef.kind === 'reference' ? normaliseRef(newRef.value) : normaliseName(newRef.value)
    if (!reference) return
    const { data, error } = await supabase.from('client_references').insert({
      household_id: id, provider_id: newRef.provider_id || null, kind: newRef.kind, reference, label: newRef.value.trim(),
    }).select('*').single()
    if (error) return setError(error.code === '23505' ? 'That reference is already linked to a household' : error.message)
    setRefs((r) => [...r, data])
    setNewRef({ ...newRef, value: '' })
  }

  async function removeRef(refId: string) {
    const { error } = await supabase.from('client_references').delete().eq('id', refId)
    if (error) return setError(error.message)
    setRefs((r) => r.filter((x) => x.id !== refId))
  }

  return (
    <div className="space-y-5">
      <PageHeader title={household.name} sub={household.adviser_id ? `Adviser: ${advisers.get(household.adviser_id)?.name}` : 'No adviser assigned'} />
      <ErrorBanner error={error} />

      <Card title="Details">
        <div className="grid gap-4 md:grid-cols-4">
          <Field label="Name"><input className={`${inputCls} w-full`} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Adviser">
            <select className={`${inputCls} w-full`} value={form.adviser_id ?? ''} onChange={(e) => setForm({ ...form, adviser_id: e.target.value || null })}>
              <option value="">— none —</option>
              {lookups.advisers.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select className={`${inputCls} w-full`} value={form.is_active ? 'a' : 'i'} onChange={(e) => setForm({ ...form, is_active: e.target.value === 'a' })}>
              <option value="a">Active</option><option value="i">Inactive</option>
            </select>
          </Field>
          <Field label="Notes"><input className={`${inputCls} w-full`} value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        </div>
        {form.adviser_id !== household.adviser_id && (
          <div className="mt-3"><Notice>A new adviser applies to revenue matched from now on. Lines already matched keep the adviser they were matched under — change those on the line itself if needed.</Notice></div>
        )}
        <div className="flex justify-end gap-2 mt-3 items-center">
          {saved && <span className="text-sm text-brand">Saved</span>}
          <Button onClick={save} disabled={!form.name.trim()}>Save</Button>
        </div>
      </Card>

      <Card title="Matching references">
        <p className="text-sm text-gray-600 mb-3">Account numbers, policy numbers and name spellings that identify this household on provider statements. Learnt automatically when you match a line.</p>
        {refs.length > 0 && (
          <table className="min-w-full mb-3">
            <thead><tr><th className={thCls}>Provider</th><th className={thCls}>Type</th><th className={thCls}>Value</th><th className={thCls}></th></tr></thead>
            <tbody>
              {refs.map((r, i) => (
                <tr key={r.id} className={i % 2 ? 'bg-row' : 'bg-white'}>
                  <td className={tdCls}>{r.provider_id ? providers.get(r.provider_id)?.name : 'Any provider'}</td>
                  <td className={tdCls}>{r.kind === 'reference' ? 'Account / policy no.' : 'Name on statement'}</td>
                  <td className={tdCls}>{r.label ?? r.reference}</td>
                  <td className={tdCls + ' text-right'}><button type="button" className="text-gray-400 hover:text-negative" onClick={() => removeRef(r.id)}><Trash2 size={15} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="flex flex-wrap gap-2">
          <select className={inputCls} value={newRef.provider_id} onChange={(e) => setNewRef({ ...newRef, provider_id: e.target.value })}>
            <option value="">Any provider</option>
            {lookups.providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select className={inputCls} value={newRef.kind} onChange={(e) => setNewRef({ ...newRef, kind: e.target.value as 'reference' | 'name' })}>
            <option value="reference">Account / policy no.</option>
            <option value="name">Name on statement</option>
          </select>
          <input className={inputCls} value={newRef.value} onChange={(e) => setNewRef({ ...newRef, value: e.target.value })} />
          <Button variant="secondary" disabled={!newRef.value.trim()} onClick={addRef}>Add reference</Button>
        </div>
      </Card>

      <Card title="Revenue history">
        {!lines.length ? <Empty>No revenue matched to this household yet.</Empty> : (
          <>
            <div className="flex flex-wrap gap-3 mb-4">
              {byFy.map(([fy, t]) => (
                <div key={fy} className="rounded border border-gray-200 px-3 py-2 text-sm">
                  <div className="text-gray-500">{fyLabel(Number(fy))} received</div>
                  <div className="font-semibold tabular-nums">{fmtMoney(t.amount)}</div>
                  <div className="text-xs text-gray-500">upfront {fmtMoney(t.upfront)} · ongoing {fmtMoney(t.ongoing)}</div>
                </div>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead><tr>
                  <th className={thCls}>Received</th><th className={thCls}>Revenue month</th><th className={thCls}>Provider</th>
                  <th className={thCls}>Fee type</th><th className={thCls}>Adviser</th><th className={thNumCls}>Ex GST</th><th className={thNumCls}>Adviser share</th>
                </tr></thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={l.id} className={i % 2 ? 'bg-row' : 'bg-white'}>
                      <td className={tdCls}><Link href={`/statements/${l.statement_id}`} className="text-accent hover:underline">{dateLabel(l.received_date)}</Link></td>
                      <td className={tdCls}>{monthLabel(l.generation_month)}</td>
                      <td className={tdCls}>{providers.get(l.provider_id)?.name}</td>
                      <td className={tdCls}>{l.fee_type ? FEE_TYPE_LABELS[l.fee_type] : <Badge tone="warn">review</Badge>}</td>
                      <td className={tdCls}>{l.adviser_id ? advisers.get(l.adviser_id)?.name : '—'}</td>
                      <td className={tdNumCls}>{fmtMoney(l.amount_cents)}</td>
                      <td className={tdNumCls}>{fmtMoney(adviserShareCents(l))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  )
}
