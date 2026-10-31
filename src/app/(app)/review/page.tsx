'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { LINE_COLUMNS, errorMessage, fetchAll, loadLookups, type Lookups } from '@/lib/data'
import type { ClientReference } from '@/lib/matching'
import { fmtMoney } from '@/lib/money'
import type { RevenueLine } from '@/lib/types'
import { Card, ErrorBanner, Loading, PageHeader } from '@/components/ui'
import { LinesTable } from '@/components/revenue/LinesTable'

/** Every line, across all statements, still missing a household or a fee type. */
export default function ReviewPage() {
  const supabase = useMemo(() => createClient(), [])
  const [lines, setLines] = useState<RevenueLine[] | null>(null)
  const [lookups, setLookups] = useState<Lookups | null>(null)
  const [refs, setRefs] = useState<ClientReference[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      fetchAll<RevenueLine>((a, b) =>
        supabase.from('revenue_lines').select(LINE_COLUMNS)
          .or('household_id.is.null,fee_type.is.null')
          .order('received_date', { ascending: false }).order('id').range(a, b) as never
      ),
      loadLookups(supabase),
      fetchAll<ClientReference>((a, b) => supabase.from('client_references').select('household_id, provider_id, kind, reference').range(a, b)),
    ]).then(([ls, l, r]) => { setLines(ls); setLookups(l); setRefs(r) })
      .catch((e) => setError(errorMessage(e)))
  }, [supabase])

  const amount = (lines ?? []).filter((l) => !l.household_id || !l.fee_type).reduce((a, l) => a + l.amount_cents, 0)

  return (
    <div>
      <PageHeader
        title="Review queue"
        sub="Lines that still need a household or a fee type. Until they do, upfronts can't be allocated to an adviser."
      />
      <ErrorBanner error={error} />
      {!lines || !lookups ? <Loading /> : (
        <Card title={`${lines.filter((l) => !l.household_id || !l.fee_type).length} lines · ${fmtMoney(amount)} ex GST`}>
          <LinesTable
            lines={lines}
            lookups={lookups}
            refs={refs}
            showContext
            onLinesUpdated={(updated) => {
              const m = new Map(updated.map((l) => [l.id, l]))
              setLines((prev) => prev!.map((l) => m.get(l.id) ?? l))
            }}
            onHouseholdCreated={(h) => setLookups((l) => l && ({ ...l, households: [...l.households, h].sort((a, b) => a.name.localeCompare(b.name)) }))}
            onProviderUpdated={(p) => setLookups((l) => l && ({ ...l, providers: l.providers.map((x) => (x.id === p.id ? p : x)) }))}
          />
        </Card>
      )}
    </div>
  )
}
