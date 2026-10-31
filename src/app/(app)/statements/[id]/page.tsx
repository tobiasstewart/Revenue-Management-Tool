'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Download, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase'
import { LINE_COLUMNS, errorMessage, fetchAll, loadLookups, type Lookups } from '@/lib/data'
import type { ClientReference } from '@/lib/matching'
import { centsToInput, fmtMoney, parseAmountToCents } from '@/lib/money'
import { dateLabel, firstOfMonth, monthKey, monthLabel } from '@/lib/periods'
import { totals } from '@/lib/reports'
import { PROVIDER_TYPE_LABELS, type RevenueLine, type Statement } from '@/lib/types'
import { Badge, Button, Card, ErrorBanner, Field, Loading, Notice, PageHeader, Stat, inputCls } from '@/components/ui'
import { LinesTable } from '@/components/revenue/LinesTable'
import { MonthSelect } from '@/components/revenue/PeriodControls'

export default function StatementPage() {
  const { id } = useParams<{ id: string }>()
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const [statement, setStatement] = useState<Statement | null>(null)
  const [lines, setLines] = useState<RevenueLine[] | null>(null)
  const [lookups, setLookups] = useState<Lookups | null>(null)
  const [refs, setRefs] = useState<ClientReference[]>([])
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ received_date: '', generation_month: '', statement_ref: '', deposit: '', notes: '' })

  const loadLines = useCallback(() =>
    fetchAll<RevenueLine>((a, b) =>
      supabase.from('revenue_lines').select(LINE_COLUMNS).eq('statement_id', id).order('row_number').order('id').range(a, b) as never
    ).then(setLines), [supabase, id])

  useEffect(() => {
    Promise.all([
      supabase.from('statements').select('*').eq('id', id).single(),
      loadLookups(supabase),
      fetchAll<ClientReference>((a, b) => supabase.from('client_references').select('household_id, provider_id, kind, reference').range(a, b)),
      loadLines(),
    ]).then(([s, l, r]) => {
      if (s.error) throw new Error(s.error.message)
      setStatement(s.data)
      setLookups(l)
      setRefs(r)
    }).catch((e) => setError(errorMessage(e)))
  }, [supabase, id, loadLines])

  if (error && !statement) return <ErrorBanner error={error} />
  if (!statement || !lines || !lookups) return <Loading />

  const provider = lookups.providers.find((p) => p.id === statement.provider_id)
  const t = totals(lines)
  const incl = t.amount + t.gst
  const diff = statement.deposit_amount_cents === null ? null : statement.deposit_amount_cents - incl

  function startEdit() {
    setForm({
      received_date: statement!.received_date,
      generation_month: monthKey(statement!.generation_month),
      statement_ref: statement!.statement_ref ?? '',
      deposit: centsToInput(statement!.deposit_amount_cents),
      notes: statement!.notes ?? '',
    })
    setEditing(true)
  }

  async function saveEdit() {
    const deposit = form.deposit.trim() ? parseAmountToCents(form.deposit) : null
    if (form.deposit.trim() && deposit === null) return setError('Deposit amount isn\'t a number')
    const { data, error } = await supabase.from('statements').update({
      received_date: form.received_date,
      generation_month: firstOfMonth(form.generation_month),
      statement_ref: form.statement_ref.trim() || null,
      deposit_amount_cents: deposit,
      notes: form.notes.trim() || null,
    }).eq('id', id).select('*').single()
    if (error) return setError(error.message)
    setStatement(data)
    setEditing(false)
    await loadLines() // dates flow down to the lines
  }

  async function setStatus(status: 'draft' | 'finalised') {
    const { data, error } = await supabase.from('statements').update({ status }).eq('id', id).select('*').single()
    if (error) return setError(error.message)
    setStatement(data)
  }

  async function download() {
    if (!statement?.storage_path) return
    const { data, error } = await supabase.storage.from('statements').createSignedUrl(statement.storage_path, 60, { download: statement.file_name ?? true })
    if (error) return setError(error.message)
    window.location.href = data.signedUrl
  }

  async function remove() {
    if (!confirm(`Delete this statement and its ${lines!.length} lines? This can't be undone.`)) return
    if (statement!.storage_path) await supabase.storage.from('statements').remove([statement!.storage_path])
    const { error } = await supabase.from('statements').delete().eq('id', id)
    if (error) return setError(error.message)
    router.push('/statements')
  }

  const todo = t.unmatchedCount + lines.filter((l) => !l.fee_type).length

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${provider?.name ?? 'Statement'} — ${dateLabel(statement.received_date)}`}
        sub={<>
          {provider && PROVIDER_TYPE_LABELS[provider.provider_type]} · received {dateLabel(statement.received_date)} · revenue month {monthLabel(statement.generation_month)}
          {statement.statement_ref && <> · ref {statement.statement_ref}</>}
        </>}
        actions={<>
          {statement.storage_path && <Button variant="secondary" onClick={download}><Download size={15} /> Original file</Button>}
          {statement.status === 'draft'
            ? <Button onClick={() => setStatus('finalised')} disabled={todo > 0} title={todo ? 'Match and classify every line first' : ''}>Mark finalised</Button>
            : <Button variant="secondary" onClick={() => setStatus('draft')}>Reopen</Button>}
          <Button variant="danger" onClick={remove}><Trash2 size={15} /> Delete</Button>
        </>}
      />
      <ErrorBanner error={error} />

      <div className="grid gap-3 md:grid-cols-5">
        <Stat label="Total ex GST" value={fmtMoney(t.amount)} sub={`${t.count} lines`} />
        <Stat label="GST" value={fmtMoney(t.gst)} />
        <Stat
          label="Bank deposit"
          value={statement.deposit_amount_cents === null ? '—' : fmtMoney(statement.deposit_amount_cents)}
          sub={diff === null ? 'Not recorded' : diff === 0 ? 'Reconciles' : `Differs by ${fmtMoney(diff)}`}
          tone={diff ? 'warn' : undefined}
        />
        <Stat label="Owed to advisers" value={fmtMoney(t.adviserShare)} tone="brand" />
        <Stat label="To review" value={String(todo)} sub={`${t.unmatchedCount} unmatched`} tone={todo ? 'warn' : undefined} />
      </div>

      <Card title="Statement details" actions={!editing && <Button variant="secondary" onClick={startEdit}>Edit</Button>}>
        {!editing ? (
          <div className="grid gap-3 md:grid-cols-4 text-sm">
            <div><div className="text-gray-500">Received in bank</div>{dateLabel(statement.received_date)}</div>
            <div><div className="text-gray-500">Revenue month</div>{monthLabel(statement.generation_month)}</div>
            <div><div className="text-gray-500">File</div>{statement.file_name ?? (statement.source === 'manual' ? 'Manual entry' : '—')}</div>
            <div><div className="text-gray-500">Status</div>{statement.status === 'finalised' ? <Badge tone="brand">finalised</Badge> : <Badge>draft</Badge>}</div>
            {statement.notes && <div className="md:col-span-4"><div className="text-gray-500">Notes</div>{statement.notes}</div>}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-5">
              <Field label="Received in bank"><input type="date" className={`${inputCls} w-full`} value={form.received_date} onChange={(e) => setForm({ ...form, received_date: e.target.value })} /></Field>
              <Field label="Revenue month"><MonthSelect className="w-full" value={form.generation_month} onChange={(m) => setForm({ ...form, generation_month: m })} /></Field>
              <Field label="Bank deposit (incl GST)"><input className={`${inputCls} w-full`} value={form.deposit} onChange={(e) => setForm({ ...form, deposit: e.target.value })} /></Field>
              <Field label="Reference"><input className={`${inputCls} w-full`} value={form.statement_ref} onChange={(e) => setForm({ ...form, statement_ref: e.target.value })} /></Field>
              <Field label="Notes"><input className={`${inputCls} w-full`} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
            </div>
            <Notice>Changing the revenue month moves every line still on the old month; lines given their own month keep it.</Notice>
            <div className="flex gap-2 justify-end">
              <Button variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>
              <Button onClick={saveEdit}>Save</Button>
            </div>
          </div>
        )}
      </Card>

      <Card title="Lines" actions={<Link href="/review" className="text-sm text-accent hover:underline">All lines needing review →</Link>}>
        <LinesTable
          lines={lines}
          lookups={lookups}
          refs={refs}
          initialFilter={todo ? 'unmatched' : 'all'}
          onLinesUpdated={(updated) => {
            const m = new Map(updated.map((l) => [l.id, l]))
            setLines((prev) => prev!.map((l) => m.get(l.id) ?? l))
          }}
          onHouseholdCreated={(h) => setLookups((l) => l && ({ ...l, households: [...l.households, h].sort((a, b) => a.name.localeCompare(b.name)) }))}
          onProviderUpdated={(p) => setLookups((l) => l && ({ ...l, providers: l.providers.map((x) => (x.id === p.id ? p : x)) }))}
        />
      </Card>
    </div>
  )
}
