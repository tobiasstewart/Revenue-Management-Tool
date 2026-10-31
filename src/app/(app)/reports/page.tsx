'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Download } from 'lucide-react'
import { createClient } from '@/lib/supabase'
import { byId, errorMessage, loadLinesForPeriod, loadLookups, type Lookups } from '@/lib/data'
import { centsCol, downloadCsv } from '@/lib/csv-export'
import { FEE_TYPE_LABELS } from '@/lib/fee-type'
import { BASIS_HELP, BASIS_LABELS, lineMonth, monthLabel, periodLabel, type Basis } from '@/lib/periods'
import { adviserShareCents, groupTotals, totals, upfrontsOwed } from '@/lib/reports'
import { PROVIDER_TYPE_LABELS, type RevenueLine } from '@/lib/types'
import { Button, Card, ErrorBanner, Loading, PageHeader, inputCls } from '@/components/ui'
import { BasisToggle, PeriodPicker, initialPeriodState, resolvePeriod, type PeriodState } from '@/components/revenue/PeriodControls'
import { ShareholderTable, TotalsTable, UpfrontsOwedTable, type Group } from '@/components/revenue/ReportTables'

type GroupBy = 'month' | 'provider' | 'provider_type' | 'adviser' | 'fee_type' | 'household'

const GROUP_LABELS: Record<GroupBy, string> = {
  month: 'Month',
  provider: 'Provider',
  provider_type: 'Provider type',
  adviser: 'Adviser',
  fee_type: 'Fee type',
  household: 'Household',
}

function Reports() {
  const supabase = useMemo(() => createClient(), [])
  const params = useSearchParams()
  const [periodState, setPeriodState] = useState<PeriodState>(initialPeriodState)
  const [basis, setBasis] = useState<Basis>(params.get('basis') === 'generated' ? 'generated' : 'received')
  const [groupBy, setGroupBy] = useState<GroupBy>('provider')
  const [lookups, setLookups] = useState<Lookups | null>(null)
  const [lines, setLines] = useState<RevenueLine[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const period = resolvePeriod(periodState)

  useEffect(() => {
    loadLookups(supabase).then(setLookups).catch((e) => setError(errorMessage(e)))
  }, [supabase])

  useEffect(() => {
    setLines(null)
    loadLinesForPeriod(supabase, basis, period).then(setLines).catch((e) => setError(errorMessage(e)))
  }, [supabase, basis, period.from, period.to])

  if (!lookups) return <><ErrorBanner error={error} /><Loading /></>

  const providers = byId(lookups.providers)
  const advisers = byId(lookups.advisers)
  const households = byId(lookups.households)

  const label = (g: GroupBy, l: RevenueLine): [string, string] => {
    switch (g) {
      case 'month': {
        const m = lineMonth(l, basis)
        return [m, monthLabel(m)]
      }
      case 'provider':
        return [l.provider_id, providers.get(l.provider_id)?.name ?? '—']
      case 'provider_type': {
        const t = providers.get(l.provider_id)?.provider_type
        return [t ?? '—', t ? PROVIDER_TYPE_LABELS[t] : '—']
      }
      case 'adviser':
        return [l.adviser_id ?? '', l.adviser_id ? advisers.get(l.adviser_id)?.name ?? '—' : 'No adviser (unmatched)']
      case 'fee_type':
        return [l.fee_type ?? '', l.fee_type ? FEE_TYPE_LABELS[l.fee_type] : 'Unclassified']
      case 'household':
        return [l.household_id ?? '', l.household_id ? households.get(l.household_id)?.name ?? '—' : 'Unmatched']
    }
  }

  const groups: Group[] = lines
    ? (() => {
        const names = new Map(lines.map((l) => label(groupBy, l)))
        const g = [...groupTotals(lines, (l) => label(groupBy, l)[0]).entries()].map(([key, t]) => ({ key, label: names.get(key) ?? '—', totals: t }))
        return groupBy === 'month' ? g.sort((a, b) => a.key.localeCompare(b.key)) : g.sort((a, b) => b.totals.amount - a.totals.amount)
      })()
    : []
  const grand = lines ? totals(lines) : null
  const fileStem = `${periodLabel(period).replace(/[^\w]+/g, '_')}_${basis}`

  function exportSummary() {
    downloadCsv(`revenue_by_${groupBy}_${fileStem}.csv`, [
      [`Revenue by ${GROUP_LABELS[groupBy].toLowerCase()} — ${periodLabel(period)} — ${BASIS_LABELS[basis]}`],
      [GROUP_LABELS[groupBy], 'Upfront', 'Ongoing', 'One-off', 'Unclassified', 'Total ex GST', 'GST', 'Total incl GST', 'To advisers', 'To business'],
      ...[...groups, { key: 'total', label: 'Total', totals: grand! }].map((g) => [
        g.label, centsCol(g.totals.upfront), centsCol(g.totals.ongoing), centsCol(g.totals.oneOff), centsCol(g.totals.unclassified),
        centsCol(g.totals.amount), centsCol(g.totals.gst), centsCol(g.totals.amount + g.totals.gst),
        centsCol(g.totals.adviserShare), centsCol(g.totals.businessShare),
      ]),
    ])
  }

  function exportLines() {
    downloadCsv(`revenue_lines_${fileStem}.csv`, [
      ['Received in bank', 'Revenue month', 'Provider', 'Provider type', 'Household', 'Adviser', 'Fee type',
        'Client on statement', 'Reference', 'Product', 'Description', 'Ex GST', 'GST', 'Incl GST', 'Adviser split %', 'Adviser share', 'Business share'],
      ...lines!.map((l) => {
        const p = providers.get(l.provider_id)
        const share = adviserShareCents(l)
        return [
          l.received_date, monthLabel(l.generation_month), p?.name, p ? PROVIDER_TYPE_LABELS[p.provider_type] : '',
          l.household_id ? households.get(l.household_id)?.name : '', l.adviser_id ? advisers.get(l.adviser_id)?.name : '',
          l.fee_type ? FEE_TYPE_LABELS[l.fee_type] : 'Unclassified', l.raw_client_name, l.raw_reference, l.product, l.description,
          centsCol(l.amount_cents), centsCol(l.gst_cents), centsCol(l.amount_cents + l.gst_cents),
          l.adviser_split_pct === null ? '' : Number(l.adviser_split_pct), centsCol(share),
          l.fee_type ? centsCol(l.amount_cents - share) : '',
        ]
      }),
    ])
  }

  function exportPayouts() {
    const owed = upfrontsOwed(lines!)
    downloadCsv(`adviser_upfronts_${fileStem}.csv`, [
      [`Adviser upfronts — ${periodLabel(period)} — ${BASIS_LABELS[basis]}`],
      ['Adviser', 'Upfront', 'One-off', 'Adviser share', 'Business retains', 'Lines'],
      ...owed.rows.map((r) => [advisers.get(r.adviserId)?.name, centsCol(r.upfront), centsCol(r.oneOff), centsCol(r.adviserShare), centsCol(r.businessShare), r.lineCount]),
      [],
      ['Not yet allocated (unmatched)', centsCol(owed.unallocated.amount), '', '', '', owed.unallocated.count],
      ['No fee type yet', centsCol(owed.unclassified.amount), '', '', '', owed.unclassified.count],
    ])
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reports"
        sub={`${periodLabel(period)} · ${BASIS_LABELS[basis].toLowerCase()}`}
        actions={<>
          <PeriodPicker state={periodState} onChange={setPeriodState} />
          <BasisToggle basis={basis} onChange={setBasis} />
        </>}
      />
      <p className="text-xs text-gray-500 -mt-3">{BASIS_HELP[basis]}</p>
      <ErrorBanner error={error} />

      {!lines || !grand ? <Loading /> : (
        <>
          <Card
            title={`Revenue by ${GROUP_LABELS[groupBy].toLowerCase()}`}
            actions={
              <div className="flex flex-wrap gap-2">
                <select className={inputCls} value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
                  {(Object.keys(GROUP_LABELS) as GroupBy[]).map((g) => <option key={g} value={g}>By {GROUP_LABELS[g].toLowerCase()}</option>)}
                </select>
                <Button variant="secondary" onClick={exportSummary} disabled={!lines.length}><Download size={15} /> Summary CSV</Button>
                <Button variant="secondary" onClick={exportLines} disabled={!lines.length}><Download size={15} /> All lines CSV</Button>
              </div>
            }
          >
            <TotalsTable groups={groups} grand={grand} firstHeader={GROUP_LABELS[groupBy]} />
          </Card>

          <Card
            title="Adviser upfronts"
            actions={<Button variant="secondary" onClick={exportPayouts} disabled={!lines.length}><Download size={15} /> Upfronts CSV</Button>}
          >
            <UpfrontsOwedTable lines={lines} lookups={lookups} />
          </Card>

          <Card title="Business share by shareholding">
            <ShareholderTable lines={lines} lookups={lookups} basis={basis} />
          </Card>
        </>
      )}
    </div>
  )
}

export default function ReportsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Reports />
    </Suspense>
  )
}
