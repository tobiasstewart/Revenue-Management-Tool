'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Upload } from 'lucide-react'
import { createClient } from '@/lib/supabase'
import { byId, errorMessage, loadLinesForPeriod, loadLookups, type Lookups } from '@/lib/data'
import { fmtMoney, fmtMoneyWhole } from '@/lib/money'
import { BASIS_HELP, addMonths, dateLabel, monthLabel, periodForMonth, todayIso, type Basis } from '@/lib/periods'
import { groupTotals, totals } from '@/lib/reports'
import type { RevenueLine } from '@/lib/types'
import { Card, ErrorBanner, LinkButton, Loading, Notice, PageHeader, Stat } from '@/components/ui'
import { BasisToggle, MonthSelect } from '@/components/revenue/PeriodControls'
import { ShareholderTable, TotalsTable, UpfrontsOwedTable } from '@/components/revenue/ReportTables'

function Dashboard() {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  // Default: last month — advisers and shareholders are paid at the start of
  // a month for the money received in the one before.
  const month = params.get('month') ?? addMonths(todayIso(), -1)
  const basis: Basis = params.get('basis') === 'generated' ? 'generated' : 'received'

  const [lookups, setLookups] = useState<Lookups | null>(null)
  const [lines, setLines] = useState<RevenueLine[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  function setParams(next: { month?: string; basis?: Basis }) {
    const p = new URLSearchParams(params.toString())
    if (next.month) p.set('month', next.month)
    if (next.basis) p.set('basis', next.basis)
    router.replace(`${pathname}?${p.toString()}`)
  }

  useEffect(() => {
    loadLookups(supabase).then(setLookups).catch((e) => setError(errorMessage(e)))
  }, [supabase])

  useEffect(() => {
    setLines(null)
    loadLinesForPeriod(supabase, basis, periodForMonth(month)).then(setLines).catch((e) => setError(errorMessage(e)))
  }, [supabase, basis, month])

  const period = periodForMonth(month)
  const t = lines ? totals(lines) : null
  const unclassified = lines?.filter((l) => !l.fee_type).length ?? 0
  const providers = lookups ? byId(lookups.providers) : null
  const providerGroups = lines && providers
    ? [...groupTotals(lines, (l) => l.provider_id).entries()]
        .map(([key, totals]) => ({ key, label: providers.get(key)?.name ?? '—', totals }))
        .sort((a, b) => b.totals.amount - a.totals.amount)
    : []

  return (
    <div className="space-y-5">
      <PageHeader
        title="Dashboard"
        sub={basis === 'received'
          ? `Money received in the bank ${dateLabel(period.from)} – ${dateLabel(period.to)}`
          : `Revenue generated in ${monthLabel(month)}, whenever it was received`}
        actions={<>
          <MonthSelect value={month} onChange={(m) => setParams({ month: m })} />
          <BasisToggle basis={basis} onChange={(b) => setParams({ basis: b })} />
        </>}
      />
      <p className="text-xs text-gray-500 -mt-3">{BASIS_HELP[basis]}</p>
      <ErrorBanner error={error} />

      {!t || !lookups ? <Loading /> : (
        <>
          {t.count === 0 && (
            <Notice>
              Nothing recorded for {monthLabel(month)} yet. <Link href="/statements/new" className="underline">Upload a statement</Link> to get started.
            </Notice>
          )}
          {(t.unmatchedCount > 0 || unclassified > 0) && (
            <Notice tone="warn">
              {t.unmatchedCount > 0 && <>{t.unmatchedCount} line{t.unmatchedCount > 1 ? 's' : ''} ({fmtMoney(t.unmatchedAmount)}) not matched to a household. </>}
              {unclassified > 0 && <>{unclassified} line{unclassified > 1 ? 's' : ''} without a fee type. </>}
              Adviser upfronts are incomplete until these are resolved. <Link href="/review" className="underline font-medium">Review now →</Link>
            </Notice>
          )}

          <div className="grid gap-3 grid-cols-2 lg:grid-cols-6">
            <Stat label="Revenue (ex GST)" value={fmtMoneyWhole(t.amount)} sub={`${t.count} lines · GST ${fmtMoneyWhole(t.gst)}`} />
            <Stat label="Upfront" value={fmtMoneyWhole(t.upfront)} />
            <Stat label="Ongoing" value={fmtMoneyWhole(t.ongoing)} />
            <Stat label="One-off" value={fmtMoneyWhole(t.oneOff)} />
            <Stat label="Owed to advisers" value={fmtMoney(t.adviserShare)} tone="brand" />
            <Stat label="Business share" value={fmtMoneyWhole(t.businessShare)} sub="To shareholders" />
          </div>

          <Card
            title={`Upfronts owed to advisers — ${monthLabel(month)}`}
            actions={basis === 'generated' ? <span className="text-xs text-amber-700">Advisers are paid on the received basis</span> : null}
          >
            <UpfrontsOwedTable lines={lines!} lookups={lookups} />
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="Business share by shareholding">
              <ShareholderTable lines={lines!} lookups={lookups} basis={basis} />
            </Card>
            <Card title="Quick links">
              <div className="flex flex-wrap gap-2">
                <LinkButton href="/statements/new"><Upload size={15} /> Upload statement</LinkButton>
                <LinkButton href="/statements/manual" variant="secondary">Manual entry</LinkButton>
                <LinkButton href="/review" variant="secondary">Review queue</LinkButton>
                <LinkButton href={`/reports?basis=${basis}`} variant="secondary">Reports</LinkButton>
              </div>
            </Card>
          </div>

          <Card title="Revenue by provider">
            <TotalsTable groups={providerGroups} grand={t} firstHeader="Provider" />
          </Card>
        </>
      )}
    </div>
  )
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Dashboard />
    </Suspense>
  )
}
