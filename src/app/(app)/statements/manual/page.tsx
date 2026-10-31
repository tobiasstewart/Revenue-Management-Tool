'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Plus, X } from 'lucide-react'
import { createClient } from '@/lib/supabase'
import { errorMessage, loadLookups, type Lookups } from '@/lib/data'
import { FEE_TYPES, FEE_TYPE_LABELS, type FeeType } from '@/lib/fee-type'
import { createHousehold } from '@/lib/line-actions'
import { fmtMoney, parseAmountToCents, splitGstInclusive } from '@/lib/money'
import { firstOfMonth, generationMonthFor, todayIso, type MonthKey } from '@/lib/periods'
import { Button, Card, ErrorBanner, Field, Loading, Notice, PageHeader, inputCls, tdCls, tdNumCls, thCls, thNumCls } from '@/components/ui'
import { HouseholdPicker } from '@/components/revenue/HouseholdPicker'
import { MonthSelect } from '@/components/revenue/PeriodControls'

interface Row {
  key: number
  householdId: string | null
  feeType: FeeType | ''
  description: string
  amount: string
}

let nextKey = 1
const blankRow = (): Row => ({ key: nextKey++, householdId: null, feeType: 'upfront', description: '', amount: '' })

/** Money a client paid straight into the bank (typically an upfront fee). */
export default function ManualEntryPage() {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const [lookups, setLookups] = useState<Lookups | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [providerId, setProviderId] = useState('')
  const [receivedDate, setReceivedDate] = useState(todayIso())
  const [genMonth, setGenMonth] = useState<MonthKey | null>(null)
  const [inclGst, setInclGst] = useState(true)
  const [notes, setNotes] = useState('')
  const [rows, setRows] = useState<Row[]>([blankRow()])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadLookups(supabase).then((l) => {
      setLookups(l)
      const direct = l.providers.find((p) => p.provider_type === 'client_direct' && p.is_active)
      if (direct) setProviderId(direct.id)
    }).catch((e) => setError(errorMessage(e)))
  }, [supabase])

  if (!lookups) return <><ErrorBanner error={error} /><Loading /></>

  const provider = lookups.providers.find((p) => p.id === providerId)
  const generationMonth = genMonth ?? (provider ? generationMonthFor(receivedDate, provider.generation_offset_months) : null)

  const parsed = rows.map((r) => {
    const cents = parseAmountToCents(r.amount)
    if (cents === null) return { ...r, ex: null, gst: null }
    const { exCents, gstCents } = inclGst ? splitGstInclusive(cents) : { exCents: cents, gstCents: 0 }
    return { ...r, ex: exCents, gst: gstCents }
  })
  const valid = parsed.filter((r) => r.ex !== null && r.ex !== 0)
  const invalid = parsed.some((r) => r.amount.trim() && r.ex === null)
  const total = valid.reduce((a, r) => a + r.ex! + r.gst!, 0)

  function update(key: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  async function save() {
    if (!provider || !generationMonth || !valid.length || invalid) return
    setSaving(true)
    setError(null)
    let statementId: string | null = null
    try {
      const { data: stmt, error: sErr } = await supabase.from('statements').insert({
        provider_id: provider.id,
        source: 'manual',
        received_date: receivedDate,
        generation_month: firstOfMonth(generationMonth),
        deposit_amount_cents: total,
        notes: notes.trim() || null,
      }).select('id').single()
      if (sErr) throw new Error(sErr.message)
      statementId = stmt.id as string
      const { error: lErr } = await supabase.from('revenue_lines').insert(valid.map((r, i) => ({
        statement_id: statementId,
        provider_id: provider.id,
        received_date: receivedDate,
        household_id: r.householdId,
        match_status: r.householdId ? 'manual' : 'unmatched',
        fee_type: r.feeType || null,
        amount_cents: r.ex,
        gst_cents: r.gst,
        raw_client_name: r.householdId ? lookups!.households.find((h) => h.id === r.householdId)?.name : null,
        description: r.description.trim() || null,
        row_number: i + 1,
      })))
      if (lErr) throw new Error(lErr.message)
      router.push(`/statements/${statementId}`)
    } catch (e) {
      if (statementId) await supabase.from('statements').delete().eq('id', statementId)
      setError(errorMessage(e))
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5 max-w-5xl">
      <PageHeader title="Manual entry" sub="Fees a client paid directly into the bank account, or anything that didn't come with a statement." />
      <ErrorBanner error={error} />
      {!lookups.providers.some((p) => p.provider_type === 'client_direct') && (
        <Notice tone="warn">
          Tip: add a provider of type &ldquo;Client direct deposit&rdquo; on the <Link className="underline" href="/providers">Providers</Link> page for these.
        </Notice>
      )}
      <Card title="Deposit">
        <div className="grid gap-4 md:grid-cols-4">
          <Field label="Received via">
            <select className={`${inputCls} w-full`} value={providerId} onChange={(e) => { setProviderId(e.target.value); setGenMonth(null) }}>
              <option value="">Choose…</option>
              {lookups.providers.filter((p) => p.is_active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Date received in bank">
            <input type="date" className={`${inputCls} w-full`} value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} />
          </Field>
          <Field label="Revenue month">
            {generationMonth ? <MonthSelect className="w-full" value={generationMonth} onChange={setGenMonth} /> : <span className="text-sm text-gray-500">Choose a provider</span>}
          </Field>
          <Field label="Amounts entered">
            <select className={`${inputCls} w-full`} value={inclGst ? 'incl' : 'ex'} onChange={(e) => setInclGst(e.target.value === 'incl')}>
              <option value="incl">Including GST</option>
              <option value="ex">Excluding GST (no GST)</option>
            </select>
          </Field>
          <div className="md:col-span-4">
            <Field label="Notes"><input className={`${inputCls} w-full`} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          </div>
        </div>
      </Card>

      <Card title="Fees">
        <table className="min-w-full">
          <thead>
            <tr>
              <th className={thCls}>Household</th>
              <th className={thCls}>Fee type</th>
              <th className={thCls}>Description</th>
              <th className={thNumCls}>Amount</th>
              <th className={thNumCls}>Ex GST</th>
              <th className={thNumCls}>GST</th>
              <th className={thCls}></th>
            </tr>
          </thead>
          <tbody>
            {parsed.map((r) => (
              <tr key={r.key}>
                <td className={tdCls + ' w-64'}>
                  <HouseholdPicker
                    households={lookups.households}
                    advisers={lookups.advisers}
                    value={r.householdId}
                    onChange={(householdId) => update(r.key, { householdId })}
                    onCreate={async (name, adviserId) => {
                      try {
                        const h = await createHousehold(supabase, name, adviserId)
                        setLookups((l) => l && ({ ...l, households: [...l.households, h] }))
                        return h
                      } catch (e) { setError(errorMessage(e)); return null }
                    }}
                  />
                </td>
                <td className={tdCls}>
                  <select className={inputCls} value={r.feeType} onChange={(e) => update(r.key, { feeType: e.target.value as FeeType | '' })}>
                    <option value="">Choose…</option>
                    {FEE_TYPES.map((t) => <option key={t} value={t}>{FEE_TYPE_LABELS[t]}</option>)}
                  </select>
                </td>
                <td className={tdCls}><input className={`${inputCls} w-full`} placeholder="e.g. Statement of Advice fee" value={r.description} onChange={(e) => update(r.key, { description: e.target.value })} /></td>
                <td className={tdCls}><input className={`${inputCls} w-28 text-right ${r.amount.trim() && r.ex === null ? 'border-negative' : ''}`} inputMode="decimal" value={r.amount} onChange={(e) => update(r.key, { amount: e.target.value })} /></td>
                <td className={tdNumCls}>{r.ex === null ? '—' : fmtMoney(r.ex)}</td>
                <td className={tdNumCls}>{r.gst === null ? '—' : fmtMoney(r.gst)}</td>
                <td className={tdCls}>
                  {rows.length > 1 && <button type="button" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} className="text-gray-400 hover:text-negative"><X size={16} /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex flex-wrap items-center justify-between gap-3 mt-3">
          <Button variant="secondary" onClick={() => setRows((rs) => [...rs, blankRow()])}><Plus size={15} /> Add another fee</Button>
          <div className="flex items-center gap-4">
            <span className="text-sm">Deposit total: <strong className="tabular-nums">{fmtMoney(total)}</strong></span>
            <Button disabled={!provider || !valid.length || invalid || saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
