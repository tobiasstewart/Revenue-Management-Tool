'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Upload, PenLine } from 'lucide-react'
import { createClient } from '@/lib/supabase'
import { byId, errorMessage, loadLookups, type Lookups } from '@/lib/data'
import { fmtMoney } from '@/lib/money'
import { addMonths, dateLabel, monthLabel, periodForMonth, todayIso, type MonthKey } from '@/lib/periods'
import type { Statement, StatementSummary } from '@/lib/types'
import { Badge, Card, Empty, ErrorBanner, LinkButton, Loading, PageHeader, inputCls, tdCls, tdNumCls, thCls, thNumCls } from '@/components/ui'
import { MonthSelect } from '@/components/revenue/PeriodControls'

export default function StatementsPage() {
  const supabase = useMemo(() => createClient(), [])
  const [month, setMonth] = useState<MonthKey>(addMonths(todayIso(), 0))
  const [providerId, setProviderId] = useState('')
  const [lookups, setLookups] = useState<Lookups | null>(null)
  const [rows, setRows] = useState<(Statement & { summary?: StatementSummary })[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadLookups(supabase).then(setLookups).catch((e) => setError(errorMessage(e)))
  }, [supabase])

  useEffect(() => {
    setRows(null)
    const p = periodForMonth(month)
    let q = supabase.from('statements').select('*').gte('received_date', p.from).lte('received_date', p.to)
    if (providerId) q = q.eq('provider_id', providerId)
    q.order('received_date', { ascending: false }).then(async ({ data, error }) => {
      if (error) return setError(error.message)
      const ids = (data ?? []).map((s) => s.id)
      const { data: sums } = ids.length
        ? await supabase.from('statement_summaries').select('*').in('statement_id', ids)
        : { data: [] }
      const sumById = new Map((sums ?? []).map((s: StatementSummary) => [s.statement_id, s]))
      setRows((data ?? []).map((s) => ({ ...s, summary: sumById.get(s.id) })))
    })
  }, [supabase, month, providerId])

  const providers = lookups ? byId(lookups.providers) : new Map()
  const total = (rows ?? []).reduce((a, s) => a + Number(s.summary?.amount_cents ?? 0) + Number(s.summary?.gst_cents ?? 0), 0)

  return (
    <div>
      <PageHeader
        title="Statements"
        sub="Every statement and deposit, by the month the money reached the bank."
        actions={<>
          <LinkButton href="/statements/new"><Upload size={15} /> Upload statement</LinkButton>
          <LinkButton href="/statements/manual" variant="secondary"><PenLine size={15} /> Manual entry</LinkButton>
        </>}
      />
      <ErrorBanner error={error} />
      <Card
        title={`Received in ${monthLabel(month)}`}
        actions={
          <div className="flex gap-2">
            <select className={inputCls} value={providerId} onChange={(e) => setProviderId(e.target.value)}>
              <option value="">All providers</option>
              {lookups?.providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <MonthSelect value={month} onChange={setMonth} />
          </div>
        }
      >
        {!rows ? <Loading /> : !rows.length ? <Empty>No statements received this month yet.</Empty> : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className={thCls}>Received</th>
                  <th className={thCls}>Provider</th>
                  <th className={thCls}>Revenue month</th>
                  <th className={thCls}>Reference</th>
                  <th className={thNumCls}>Lines</th>
                  <th className={thNumCls}>Incl GST</th>
                  <th className={thNumCls}>Bank deposit</th>
                  <th className={thCls}>To do</th>
                  <th className={thCls}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s, i) => {
                  const incl = Number(s.summary?.amount_cents ?? 0) + Number(s.summary?.gst_cents ?? 0)
                  const unmatched = Number(s.summary?.unmatched_count ?? 0)
                  const unclassified = Number(s.summary?.unclassified_count ?? 0)
                  const off = s.deposit_amount_cents !== null && s.deposit_amount_cents !== incl
                  return (
                    <tr key={s.id} className={i % 2 ? 'bg-row' : 'bg-white'}>
                      <td className={tdCls}>{dateLabel(s.received_date)}</td>
                      <td className={tdCls}>
                        <Link href={`/statements/${s.id}`} className="text-accent font-medium hover:underline">
                          {providers.get(s.provider_id)?.name ?? '—'}
                        </Link>
                        {s.source === 'manual' && <span className="ml-2"><Badge>manual</Badge></span>}
                      </td>
                      <td className={tdCls}>{monthLabel(s.generation_month)}</td>
                      <td className={tdCls}>{s.statement_ref || s.file_name || '—'}</td>
                      <td className={tdNumCls}>{s.summary?.line_count ?? 0}</td>
                      <td className={tdNumCls}>{fmtMoney(incl)}</td>
                      <td className={tdNumCls}>
                        {s.deposit_amount_cents === null ? '—' : fmtMoney(s.deposit_amount_cents)}
                        {off && <div><Badge tone="bad">differs</Badge></div>}
                      </td>
                      <td className={tdCls}>
                        {unmatched > 0 && <Badge tone="warn">{unmatched} unmatched</Badge>}{' '}
                        {unclassified > 0 && <Badge tone="warn">{unclassified} fee type</Badge>}
                        {!unmatched && !unclassified && <span className="text-gray-400">—</span>}
                      </td>
                      <td className={tdCls}>{s.status === 'finalised' ? <Badge tone="brand">finalised</Badge> : <Badge>draft</Badge>}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td className={tdCls} colSpan={5}>Total received</td>
                  <td className={tdNumCls}>{fmtMoney(total)}</td>
                  <td className={tdCls} colSpan={3}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
