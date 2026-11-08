'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Download, Lock, LockOpen } from 'lucide-react'
import { clsx } from 'clsx'
import { createClient } from '@/lib/supabase'
import { byId, errorMessage, fetchAll, loadLinesForPeriod, loadLookups, type Lookups } from '@/lib/data'
import { centsCol, downloadCsv } from '@/lib/csv-export'
import { fmtMoney, fmtMoneyWhole } from '@/lib/money'
import {
  FREQUENCY_LABELS, buildSnapshot, closeBlockers, closeWarnings, defaultCloseMonth, hasBlockers, snapshotDrift, statementChecklist,
  type ChecklistRow, type CloseSnapshot, type CloseStatement,
} from '@/lib/month-close'
import { addMonths, dateLabel, firstOfMonth, lastOfMonth, monthLabel, periodForMonth, todayIso, type MonthKey } from '@/lib/periods'
import type { MonthClose, RevenueLine } from '@/lib/types'
import { Badge, Button, Card, Empty, ErrorBanner, Field, Loading, Notice, PageHeader, Stat, inputCls, tdCls, tdNumCls, thCls, thNumCls } from '@/components/ui'
import { MonthSelect } from '@/components/revenue/PeriodControls'
import { ShareholderTable, UpfrontsOwedTable } from '@/components/revenue/ReportTables'

interface UserLite { id: string; email: string; full_name: string | null }

const STATUS_BADGE: Record<ChecklistRow['status'], (r: ChecklistRow) => React.ReactNode> = {
  ok: () => <Badge tone="brand">In</Badge>,
  short: (r) => <Badge tone="warn">{r.statements.length} of {r.expected}</Badge>,
  missing: () => <Badge tone="bad">Missing</Badge>,
  overdue: () => <Badge tone="warn">Overdue</Badge>,
  not_expected: () => <Badge>None expected</Badge>,
}

function MonthClosePage() {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const month: MonthKey = params.get('month') ?? defaultCloseMonth(todayIso())

  const [lookups, setLookups] = useState<Lookups | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [users, setUsers] = useState<UserLite[]>([])
  const [lines, setLines] = useState<RevenueLine[] | null>(null)
  const [inMonth, setInMonth] = useState<CloseStatement[] | null>(null)
  const [recent, setRecent] = useState<CloseStatement[]>([])
  const [history, setHistory] = useState<MonthClose[]>([])
  const [closedMonths, setClosedMonths] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [acks, setAcks] = useState<Set<string>>(new Set())
  const [notes, setNotes] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    Promise.all([
      loadLookups(supabase),
      supabase.rpc('is_firm_admin'),
      supabase.from('users').select('id, email, full_name'),
    ]).then(([l, admin, u]) => {
      setLookups(l)
      setIsAdmin(admin.data === true)
      setUsers((u.data ?? []) as UserLite[])
    }).catch((e) => setError(errorMessage(e)))
  }, [supabase])

  const load = useCallback(async () => {
    setLines(null)
    setInMonth(null)
    setAcks(new Set())
    const from = firstOfMonth(month)
    const to = lastOfMonth(month)
    try {
      const [ls, stmts, earlier, closes, recentCloses] = await Promise.all([
        loadLinesForPeriod(supabase, 'received', periodForMonth(month)),
        supabase.from('statements').select('id, provider_id, received_date, deposit_amount_cents, status')
          .gte('received_date', from).lte('received_date', to).order('received_date'),
        fetchAll<{ id: string; provider_id: string; received_date: string }>((a, b) =>
          supabase.from('statements').select('id, provider_id, received_date')
            .gte('received_date', firstOfMonth(addMonths(month, -3))).lt('received_date', from).range(a, b) as never),
        supabase.from('month_closes').select('*').eq('month', from).order('closed_at', { ascending: false }),
        supabase.from('month_closes').select('month').is('reopened_at', null).gte('month', firstOfMonth(addMonths(month, -11))),
      ])
      for (const r of [stmts, closes, recentCloses]) if (r.error) throw new Error(r.error.message)
      const ids = (stmts.data ?? []).map((s) => s.id)
      const sums = ids.length
        ? await supabase.from('statement_summaries').select('statement_id, line_count, amount_cents, gst_cents').in('statement_id', ids)
        : { data: [], error: null }
      if (sums.error) throw new Error(sums.error.message)
      const sumBy = new Map((sums.data ?? []).map((s) => [s.statement_id as string, s]))
      setInMonth((stmts.data ?? []).map((s) => {
        const t = sumBy.get(s.id)
        return {
          ...s,
          deposit_amount_cents: s.deposit_amount_cents === null ? null : Number(s.deposit_amount_cents),
          line_count: Number(t?.line_count ?? 0),
          amount_cents: Number(t?.amount_cents ?? 0),
          gst_cents: Number(t?.gst_cents ?? 0),
        } as CloseStatement
      }))
      setRecent(earlier.map((s) => ({ ...s, deposit_amount_cents: null, status: 'finalised', line_count: 0, amount_cents: 0, gst_cents: 0 })))
      setHistory((closes.data ?? []) as MonthClose[])
      setClosedMonths(new Set((recentCloses.data ?? []).map((c) => (c.month as string).slice(0, 7))))
      setLines(ls)
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [supabase, month])

  useEffect(() => { load() }, [load])

  const current = history.find((c) => !c.reopened_at) ?? null
  const userName = (id: string | null) => {
    const u = users.find((x) => x.id === id)
    return u ? u.full_name ?? u.email : 'someone'
  }

  const ready = lookups && lines && inMonth
  const checklist = ready ? statementChecklist(month, lookups.providers, inMonth, recent) : []
  const blockers = lines ? closeBlockers(lines) : null
  const warnings = ready ? closeWarnings(lines, checklist, lookups.shareholders, month) : []
  const adviserNames = useMemo(() => new Map((lookups?.advisers ?? []).map((a) => [a.id, a.name])), [lookups])
  const live: CloseSnapshot | null = ready
    ? buildSnapshot({ month, lines, checklist, shareholders: lookups.shareholders, adviserNames, acknowledged: [] })
    : null
  const drift = current && live ? snapshotDrift(current.snapshot, live) : []
  const canClose = isAdmin && !!blockers && !hasBlockers(blockers) && warnings.every((w) => acks.has(w.key)) && !busy

  function setMonth(m: MonthKey) {
    router.replace(`${pathname}?month=${m}`)
  }

  async function close() {
    if (!ready || !canClose) return
    setBusy(true)
    setError(null)
    const snapshot = buildSnapshot({ month, lines, checklist, shareholders: lookups.shareholders, adviserNames, acknowledged: warnings })
    const { error } = await supabase.rpc('close_month', { p_month: firstOfMonth(month), p_snapshot: snapshot, p_notes: notes })
    setBusy(false)
    if (error) return setError(error.message)
    setNotes('')
    await load()
  }

  async function reopen() {
    if (!reason.trim()) return
    setBusy(true)
    setError(null)
    const { error } = await supabase.rpc('reopen_month', { p_month: firstOfMonth(month), p_reason: reason })
    setBusy(false)
    if (error) return setError(error.message)
    setReason('')
    await load()
  }

  function exportPayouts(s: CloseSnapshot, label: string) {
    downloadCsv(`payouts_${s.month}${current ? '' : '_draft'}.csv`, [
      [`Payouts for money received in ${monthLabel(s.month)} — ${label}`],
      [],
      ['Adviser', 'Upfront (ex GST)', 'One-off (ex GST)', 'Adviser share', 'Lines'],
      ...s.advisers.map((a) => [a.name, centsCol(a.upfront), centsCol(a.oneOff), centsCol(a.adviserShare), a.lineCount]),
      ['Total', '', '', centsCol(s.advisers.reduce((x, a) => x + a.adviserShare, 0)), ''],
      [],
      ['Shareholder', 'Share %', 'Amount (ex GST)'],
      ...s.shareholders.map((h) => [h.name, h.sharePct, centsCol(h.amount)]),
      ['Business share', '', centsCol(s.shareholderPool)],
    ])
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Month-end close"
        sub={`Money received in ${monthLabel(month)} — what advisers and shareholders are paid at the start of ${monthLabel(addMonths(month, 1))}.`}
        actions={<MonthSelect value={month} onChange={setMonth} />}
      />

      <div className="flex flex-wrap gap-1.5">
        {Array.from({ length: 6 }, (_, i) => addMonths(defaultCloseMonth(todayIso()), -5 + i)).map((m) => (
          <button key={m} type="button" onClick={() => setMonth(m)}
            className={clsx('flex items-center gap-1 rounded-full border px-3 py-1 text-xs',
              m === month ? 'border-brand bg-brand text-white' : 'border-gray-300 bg-white text-gray-700 hover:border-brand')}>
            {closedMonths.has(m) ? <Lock size={11} /> : <LockOpen size={11} className="opacity-50" />}
            {monthLabel(m)}
          </button>
        ))}
      </div>

      <ErrorBanner error={error} />
      {!ready || !live || !blockers ? <Loading /> : current ? (
        <ClosedView
          close={current}
          closedByName={userName(current.closed_by)}
          drift={drift}
          isAdmin={isAdmin}
          reason={reason}
          setReason={setReason}
          reopen={reopen}
          busy={busy}
          onExport={() => exportPayouts(current.snapshot, `as paid (closed ${dateLabel(current.closed_at.slice(0, 10))})`)}
        />
      ) : (
        <>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
            <Stat label="Received (ex GST)" value={fmtMoneyWhole(live.totals.amount)} sub={`${live.totals.count} lines · ${inMonth.length} statements`} />
            <Stat label="Upfront + one-off" value={fmtMoneyWhole(live.totals.upfront + live.totals.oneOff)} />
            <Stat label="Owed to advisers" value={fmtMoney(live.totals.adviserShare)} tone="brand" />
            <Stat label="Business share" value={fmtMoneyWhole(live.totals.businessShare)} sub="To shareholders" />
            <Stat label="To fix before closing" value={String(blockers.unclassified.count + blockers.upfrontNoAdviser.count)}
              tone={hasBlockers(blockers) ? 'warn' : undefined} sub={hasBlockers(blockers) ? 'See below' : 'Nothing blocking'} />
          </div>

          <Card title="1. Statements received">
            <Checklist rows={checklist} />
          </Card>

          <Card title="2. Lines to resolve" actions={<Link href="/review" className="text-sm text-accent hover:underline">Review queue →</Link>}>
            <Issues lines={lines} blockers={blockers} lookups={lookups} />
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="3. Adviser payouts">
              <UpfrontsOwedTable lines={lines} lookups={lookups} />
            </Card>
            <Card title="4. Shareholder distribution">
              <ShareholderTable lines={lines} lookups={lookups} basis="received" />
            </Card>
          </div>

          <Card title="5. Close the month" actions={
            <Button variant="secondary" onClick={() => exportPayouts(live, 'DRAFT, month not closed')}><Download size={15} /> Payouts CSV</Button>
          }>
            {hasBlockers(blockers) ? (
              <Notice tone="warn">Resolve the lines in step 2 first — until every line has a fee type and every upfront has an adviser, the payouts above aren&apos;t final.</Notice>
            ) : (
              <div className="space-y-3">
                {warnings.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm text-gray-700">Confirm each of these is understood:</p>
                    {warnings.map((w) => (
                      <label key={w.key} className="flex items-start gap-2 text-sm">
                        <input type="checkbox" className="mt-0.5" checked={acks.has(w.key)}
                          onChange={(e) => setAcks((a) => { const n = new Set(a); if (e.target.checked) n.add(w.key); else n.delete(w.key); return n })} />
                        <span>{w.message}</span>
                      </label>
                    ))}
                  </div>
                )}
                <Field label="Notes (optional)">
                  <input className={`${inputCls} w-full`} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Paid advisers 3 Oct" />
                </Field>
                <div className="flex items-center gap-3">
                  <Button onClick={close} disabled={!canClose}><Lock size={15} /> Close {monthLabel(month)}</Button>
                  <span className="text-xs text-gray-500">
                    {!isAdmin ? 'Only an admin can close a month.'
                      : 'Freezes these payouts, marks the month’s statements finalised, and stops changes to anything that would alter them.'}
                  </span>
                </div>
              </div>
            )}
          </Card>
        </>
      )}

      {history.some((c) => c.reopened_at) && (
        <Card title={`Earlier closes of ${monthLabel(month)}`}>
          <ul className="text-sm space-y-1">
            {history.filter((c) => c.reopened_at).map((c) => (
              <li key={c.id}>
                Closed {dateLabel(c.closed_at.slice(0, 10))} by {userName(c.closed_by)} (advisers {fmtMoney(c.snapshot.totals.adviserShare)}),
                reopened {dateLabel(c.reopened_at!.slice(0, 10))} by {userName(c.reopened_by)}: <em>{c.reopen_reason}</em>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

function Checklist({ rows }: { rows: ChecklistRow[] }) {
  if (!rows.length) return <Empty>No active providers.</Empty>
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full">
        <thead>
          <tr>
            <th className={thCls}>Provider</th>
            <th className={thCls}>Expected</th>
            <th className={thCls}>Status</th>
            <th className={thCls}>Statement</th>
            <th className={thNumCls}>Statement total (incl GST)</th>
            <th className={thNumCls}>Bank deposit</th>
            <th className={thCls}>Reconciled</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const bg = i % 2 ? 'bg-row' : 'bg-white'
            const head = (
              <>
                <td className={tdCls + ' font-medium'}>{r.provider.name}</td>
                <td className={tdCls + ' text-xs text-gray-600'}>
                  {FREQUENCY_LABELS[r.provider.statement_frequency]}
                  {r.lastReceived && !r.statements.length && <div>last {dateLabel(r.lastReceived)}</div>}
                </td>
                <td className={tdCls}>{STATUS_BADGE[r.status](r)}</td>
              </>
            )
            if (!r.statements.length) {
              return <tr key={r.provider.id} className={bg}>{head}<td className={tdCls} colSpan={4} /></tr>
            }
            return r.statements.map((s, j) => (
              <tr key={s.id} className={bg}>
                {j === 0 ? head : <td className={tdCls} colSpan={3} />}
                <td className={tdCls}>
                  <Link href={`/statements/${s.id}`} className="text-accent hover:underline">{dateLabel(s.received_date)}</Link>
                  <span className="text-xs text-gray-500"> · {s.line_count} lines</span>
                </td>
                <td className={tdNumCls}>{fmtMoney(s.inclCents)}</td>
                <td className={tdNumCls}>{fmtMoney(s.deposit_amount_cents)}</td>
                <td className={tdCls}>
                  {s.reconciliation === 'ok' ? <Badge tone="brand">Yes</Badge>
                    : s.reconciliation === 'differs' ? <Badge tone="bad">Off by {fmtMoney(s.diff)}</Badge>
                    : <Badge tone="warn">No deposit</Badge>}
                </td>
              </tr>
            ))
          })}
        </tbody>
      </table>
      <p className="text-xs text-gray-500 mt-2">
        Expected statements come from each provider&apos;s frequency (set on the <Link href="/providers" className="underline">Providers</Link> page).
        A statement that arrives after the month closes belongs to the month it&apos;s received.
      </p>
    </div>
  )
}

function Issues({ lines, blockers, lookups }: { lines: RevenueLine[]; blockers: ReturnType<typeof closeBlockers>; lookups: Lookups }) {
  const providers = byId(lookups.providers)
  // Where the problem lines are, by statement, so each can be opened.
  const byStatement = new Map<string, { provider: string; unclassified: number; noAdviser: number; unmatched: number }>()
  for (const l of lines) {
    const row = byStatement.get(l.statement_id) ??
      byStatement.set(l.statement_id, { provider: providers.get(l.provider_id)?.name ?? '—', unclassified: 0, noAdviser: 0, unmatched: 0 }).get(l.statement_id)!
    if (!l.fee_type) row.unclassified++
    else if (l.fee_type !== 'ongoing' && !l.adviser_id) row.noAdviser++
    if (!l.household_id) row.unmatched++
  }
  const withIssues = [...byStatement.entries()].filter(([, r]) => r.unclassified || r.noAdviser || r.unmatched)
  if (!withIssues.length) return <p className="text-sm text-gray-700">Every line is matched and classified.</p>
  return (
    <div className="space-y-3">
      {hasBlockers(blockers) && (
        <Notice tone="warn">
          Blocking the close:{' '}
          {blockers.unclassified.count > 0 && <>{blockers.unclassified.count} line{blockers.unclassified.count > 1 ? 's' : ''} ({fmtMoney(blockers.unclassified.amount)}) without a fee type. </>}
          {blockers.upfrontNoAdviser.count > 0 && <>{blockers.upfrontNoAdviser.count} upfront / one-off line{blockers.upfrontNoAdviser.count > 1 ? 's' : ''} ({fmtMoney(blockers.upfrontNoAdviser.amount)}) with no adviser. </>}
        </Notice>
      )}
      <table className="min-w-full">
        <thead>
          <tr>
            <th className={thCls}>Statement</th>
            <th className={thNumCls}>No fee type</th>
            <th className={thNumCls}>Upfront, no adviser</th>
            <th className={thNumCls}>No household</th>
          </tr>
        </thead>
        <tbody>
          {withIssues.map(([id, r], i) => (
            <tr key={id} className={i % 2 ? 'bg-row' : 'bg-white'}>
              <td className={tdCls}><Link href={`/statements/${id}`} className="text-accent hover:underline">{r.provider}</Link></td>
              <td className={tdNumCls + (r.unclassified ? ' text-negative font-medium' : '')}>{r.unclassified || '—'}</td>
              <td className={tdNumCls + (r.noAdviser ? ' text-negative font-medium' : '')}>{r.noAdviser || '—'}</td>
              <td className={tdNumCls}>{r.unmatched || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-gray-500">Unmatched lines don&apos;t block the close when they&apos;re ongoing or the statement names the adviser — but match them so client reports are complete.</p>
    </div>
  )
}

function ClosedView({ close, closedByName, drift, isAdmin, reason, setReason, reopen, busy, onExport }: {
  close: MonthClose
  closedByName: string
  drift: string[]
  isAdmin: boolean
  reason: string
  setReason: (s: string) => void
  reopen: () => void
  busy: boolean
  onExport: () => void
}) {
  const s = close.snapshot
  return (
    <>
      <Notice>
        <span className="flex items-center gap-1.5 font-medium"><Lock size={14} /> Closed {dateLabel(close.closed_at.slice(0, 10))} by {closedByName}.</span>
        These are the payouts as settled. Statements and lines received this month can no longer be changed in ways that would alter them.
        {close.notes && <> Note: <em>{close.notes}</em></>}
      </Notice>
      {drift.length > 0 && (
        <Notice tone="warn">
          Today&apos;s figures differ from what was paid ({drift.join(', ')}) — e.g. shareholdings were edited after closing. The figures below are as paid.
        </Notice>
      )}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Stat label="Received (ex GST)" value={fmtMoneyWhole(s.totals.amount)} sub={`${s.totals.count} lines · ${s.statements.length} statements`} />
        <Stat label="Upfront + one-off" value={fmtMoneyWhole(s.totals.upfront + s.totals.oneOff)} />
        <Stat label="Paid to advisers" value={fmtMoney(s.totals.adviserShare)} tone="brand" />
        <Stat label="Business share" value={fmtMoneyWhole(s.shareholderPool)} sub="To shareholders" />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Adviser payouts (as paid)" actions={<Button variant="secondary" onClick={onExport}><Download size={15} /> CSV</Button>}>
          {!s.advisers.length ? <Empty>No upfront or one-off revenue this month.</Empty> : (
            <table className="min-w-full">
              <thead><tr><th className={thCls}>Adviser</th><th className={thNumCls}>Upfront</th><th className={thNumCls}>One-off</th><th className={thNumCls}>Paid</th></tr></thead>
              <tbody>
                {s.advisers.map((a, i) => (
                  <tr key={a.adviserId} className={i % 2 ? 'bg-row' : 'bg-white'}>
                    <td className={tdCls}>{a.name}</td>
                    <td className={tdNumCls}>{fmtMoney(a.upfront)}</td>
                    <td className={tdNumCls}>{fmtMoney(a.oneOff)}</td>
                    <td className={tdNumCls + ' font-semibold'}>{fmtMoney(a.adviserShare)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Shareholder distribution (as paid)">
          {!s.shareholders.length ? <Empty>No shareholders were set up when this month closed.</Empty> : (
            <table className="min-w-full">
              <thead><tr><th className={thCls}>Shareholder</th><th className={thNumCls}>Share</th><th className={thNumCls}>Amount</th></tr></thead>
              <tbody>
                {s.shareholders.map((h, i) => (
                  <tr key={h.shareholderId} className={i % 2 ? 'bg-row' : 'bg-white'}>
                    <td className={tdCls}>{h.name}</td>
                    <td className={tdNumCls}>{h.sharePct}%</td>
                    <td className={tdNumCls}>{fmtMoney(h.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
      {s.acknowledged.length > 0 && (
        <Card title="Acknowledged at close">
          <ul className="list-disc pl-5 text-sm space-y-1">{s.acknowledged.map((m) => <li key={m}>{m}</li>)}</ul>
        </Card>
      )}
      {isAdmin && (
        <Card title="Reopen this month">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Reason (kept on record)">
              <input className={`${inputCls} w-96`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Zurich statement for 30 Sep filed late" />
            </Field>
            <Button variant="secondary" disabled={!reason.trim() || busy} onClick={reopen}><LockOpen size={15} /> Reopen</Button>
          </div>
          <p className="text-xs text-gray-500 mt-2">Payouts already made won&apos;t change by themselves — after correcting, close the month again and settle any difference with the next payout.</p>
        </Card>
      )}
    </>
  )
}

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <MonthClosePage />
    </Suspense>
  )
}
