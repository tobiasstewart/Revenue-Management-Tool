'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import { FEE_TYPES, FEE_TYPE_LABELS, type FeeType } from '@/lib/fee-type'
import { fmtMoney } from '@/lib/money'
import { dateLabel, firstOfMonth, monthKey } from '@/lib/periods'
import { adviserShareCents } from '@/lib/reports'
import { buildMatcher, type ClientReference } from '@/lib/matching'
import { byId, errorMessage, type Lookups } from '@/lib/data'
import { clientKey, createHousehold, rememberAdviser, rememberFeeType, rememberMatch, statementAdviserKey, updateLines, type LinePatch } from '@/lib/line-actions'
import type { Household, Provider, RevenueLine } from '@/lib/types'
import { Badge, Button, ErrorBanner, inputCls, tdCls, tdNumCls, thCls, thNumCls } from '@/components/ui'
import { HouseholdPicker } from './HouseholdPicker'
import { MonthSelect } from './PeriodControls'

type Filter = 'all' | 'unmatched' | 'unclassified'

/**
 * The line editor for a statement or the review queue: match households,
 * set fee types and revenue months, one at a time or in bulk. Matching a line
 * with "remember" on learns the account/policy number for the provider and
 * matches the same client's other lines in view.
 */
export function LinesTable({
  lines,
  lookups,
  refs,
  onLinesUpdated,
  onHouseholdCreated,
  onProviderUpdated,
  showContext = false,
  initialFilter = 'all',
}: {
  lines: RevenueLine[]
  lookups: Lookups
  refs: ClientReference[]
  onLinesUpdated: (updated: RevenueLine[]) => void
  onHouseholdCreated: (h: Household) => void
  onProviderUpdated: (p: Provider) => void
  showContext?: boolean
  initialFilter?: Filter
}) {
  const supabase = useMemo(() => createClient(), [])
  const [filter, setFilter] = useState<Filter>(initialFilter)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const households = byId(lookups.households)
  const advisers = byId(lookups.advisers)
  const providers = byId(lookups.providers)
  const matcher = useMemo(() => buildMatcher(refs, lookups.households), [refs, lookups.households])

  const counts = {
    all: lines.length,
    unmatched: lines.filter((l) => !l.household_id).length,
    unclassified: lines.filter((l) => !l.fee_type).length,
  }
  const shown = lines.filter((l) =>
    filter === 'unmatched' ? !l.household_id : filter === 'unclassified' ? !l.fee_type : true
  )

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  function patch(ids: string[], p: LinePatch) {
    return run(async () => onLinesUpdated(await updateLines(supabase, ids, p)))
  }

  function matchHousehold(line: RevenueLine, householdId: string | null) {
    return run(async () => {
      const ids = [line.id]
      if (householdId && remember) {
        await rememberMatch(supabase, line, householdId)
        const key = clientKey(line)
        if (key) {
          for (const l of lines) {
            if (l.id !== line.id && !l.household_id && clientKey(l) === key) ids.push(l.id)
          }
        }
      }
      onLinesUpdated(await updateLines(supabase, ids, { household_id: householdId }))
    })
  }

  /** Choosing an adviser on a line the statement named an adviser for teaches
   *  the provider's code (when "remember" is on) and fixes that adviser's
   *  other lines in view that aren't already set by hand. */
  function setAdviser(line: RevenueLine, adviserId: string | null) {
    return run(async () => {
      const ids = [line.id]
      const key = statementAdviserKey(line)
      if (adviserId && remember && key) {
        await rememberAdviser(supabase, line, adviserId)
        for (const l of lines) {
          if (l.id !== line.id && statementAdviserKey(l) === key && l.adviser_source !== 'manual') ids.push(l.id)
        }
      }
      const others = ids.slice(1)
      const updated = await updateLines(supabase, [line.id], { adviser_id: adviserId })
      if (others.length) updated.push(...(await updateLines(supabase, others, { adviser_id: adviserId, adviser_source: 'statement' })))
      onLinesUpdated(updated)
    })
  }

  function setFeeType(line: RevenueLine, feeType: FeeType | null) {
    return run(async () => {
      const ids = [line.id]
      if (feeType && line.raw_fee_type) {
        // Same wording from the same provider, still unclassified, follows.
        for (const l of lines) {
          if (l.id !== line.id && !l.fee_type && l.provider_id === line.provider_id && l.raw_fee_type === line.raw_fee_type) ids.push(l.id)
        }
        const provider = providers.get(line.provider_id)
        if (provider) onProviderUpdated(await rememberFeeType(supabase, provider, line.raw_fee_type, feeType))
      }
      onLinesUpdated(await updateLines(supabase, ids, { fee_type: feeType }))
    })
  }

  async function create(name: string, adviserId: string | null) {
    try {
      const h = await createHousehold(supabase, name, adviserId)
      onHouseholdCreated(h)
      return h
    } catch (e) {
      setError(errorMessage(e))
      return null
    }
  }

  const selectedIds = [...selected].filter((id) => shown.some((l) => l.id === id))
  const allShownSelected = shown.length > 0 && shown.every((l) => selected.has(l.id))

  return (
    <div>
      <ErrorBanner error={error} />
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="inline-flex rounded border border-gray-300 overflow-hidden text-sm">
          {(['all', 'unmatched', 'unclassified'] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 ${filter === f ? 'bg-brand text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
            >
              {f === 'all' ? 'All' : f === 'unmatched' ? 'Needs household' : 'Needs fee type'} ({counts[f]})
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Remember matches for future statements
        </label>
      </div>

      {selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3 rounded bg-brand-light px-3 py-2 text-sm">
          <span className="font-medium">{selectedIds.length} selected</span>
          <select
            className={inputCls}
            value=""
            disabled={busy}
            onChange={(e) => e.target.value && patch(selectedIds, { fee_type: e.target.value as FeeType })}
          >
            <option value="">Set fee type…</option>
            {FEE_TYPES.map((t) => <option key={t} value={t}>{FEE_TYPE_LABELS[t]}</option>)}
          </select>
          <div className="w-56">
            <HouseholdPicker
              households={lookups.households}
              advisers={lookups.advisers}
              value={null}
              onChange={(hid) => hid && patch(selectedIds, { household_id: hid })}
              onCreate={create}
              disabled={busy}
            />
          </div>
          <Button variant="secondary" onClick={() => setSelected(new Set())}>Clear selection</Button>
        </div>
      )}

      <div className="overflow-x-auto border border-gray-200 rounded">
        <table className="min-w-full">
          <thead>
            <tr>
              <th className={thCls}>
                <input
                  type="checkbox"
                  checked={allShownSelected}
                  onChange={(e) => setSelected(e.target.checked ? new Set(shown.map((l) => l.id)) : new Set())}
                />
              </th>
              {showContext && <th className={thCls}>Provider / received</th>}
              <th className={thCls}>On the statement</th>
              <th className={thCls}>Detail</th>
              <th className={thCls}>Fee type</th>
              <th className={thCls}>Household</th>
              <th className={thCls}>Adviser</th>
              <th className={thCls}>Revenue month</th>
              <th className={thNumCls}>Ex GST</th>
              <th className={thNumCls}>GST</th>
              <th className={thNumCls}>Adviser share</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((l, i) => {
              const suggestion = !l.household_id ? matcher(l.provider_id, l.raw_reference, l.raw_client_name).suggestionId : null
              const household = l.household_id ? households.get(l.household_id) : null
              const share = adviserShareCents(l)
              return (
                <tr key={l.id} className={i % 2 ? 'bg-row' : 'bg-white'}>
                  <td className={tdCls}>
                    <input
                      type="checkbox"
                      checked={selected.has(l.id)}
                      onChange={(e) => {
                        const next = new Set(selected)
                        if (e.target.checked) next.add(l.id)
                        else next.delete(l.id)
                        setSelected(next)
                      }}
                    />
                  </td>
                  {showContext && (
                    <td className={tdCls}>
                      <Link href={`/statements/${l.statement_id}`} className="text-accent hover:underline">
                        {providers.get(l.provider_id)?.name ?? '—'}
                      </Link>
                      <div className="text-xs text-gray-500">{dateLabel(l.received_date)}</div>
                    </td>
                  )}
                  <td className={tdCls}>
                    <div className="font-medium">{l.raw_client_name || '—'}</div>
                    <div className="text-xs text-gray-500">
                      {l.raw_reference || 'No reference'}{l.row_number ? ` · row ${l.row_number}` : ''}
                    </div>
                  </td>
                  <td className={tdCls + ' max-w-[16rem]'}>
                    <div className="truncate">{l.product || l.description || '—'}</div>
                    {l.raw_fee_type && <div className="text-xs text-gray-500 truncate">{l.raw_fee_type}</div>}
                  </td>
                  <td className={tdCls}>
                    <select
                      className={`${inputCls} ${l.fee_type ? '' : 'border-amber-400 text-amber-800'}`}
                      value={l.fee_type ?? ''}
                      disabled={busy}
                      onChange={(e) => setFeeType(l, (e.target.value || null) as FeeType | null)}
                    >
                      <option value="">Choose…</option>
                      {FEE_TYPES.map((t) => <option key={t} value={t}>{FEE_TYPE_LABELS[t]}</option>)}
                    </select>
                  </td>
                  <td className={tdCls}>
                    <HouseholdPicker
                      households={lookups.households}
                      advisers={lookups.advisers}
                      value={l.household_id}
                      suggestedName={l.raw_client_name}
                      onChange={(hid) => matchHousehold(l, hid)}
                      onCreate={create}
                      disabled={busy}
                    />
                    {suggestion && (
                      <button
                        type="button"
                        className="mt-1 text-xs text-accent hover:underline"
                        onClick={() => matchHousehold(l, suggestion)}
                      >
                        Suggested: {households.get(suggestion)?.name} — accept
                      </button>
                    )}
                    {household && l.match_status === 'auto' && <div className="mt-1"><Badge tone="brand">auto-matched</Badge></div>}
                  </td>
                  <td className={tdCls}>
                    <select
                      className={inputCls}
                      value={l.adviser_id ?? ''}
                      disabled={busy}
                      onChange={(e) => setAdviser(l, e.target.value || null)}
                    >
                      <option value="">—</option>
                      {lookups.advisers.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                    {(l.raw_adviser_name || l.raw_adviser_code) && (
                      <div className="text-xs text-gray-500 mt-1 truncate max-w-[12rem]" title={[l.raw_adviser_name, l.raw_adviser_code].filter(Boolean).join(' · ')}>
                        Statement: {l.raw_adviser_name || l.raw_adviser_code}
                      </div>
                    )}
                    {household && l.adviser_id && household.adviser_id !== l.adviser_id && (
                      <div className="text-xs text-amber-700 mt-1">
                        Household&apos;s adviser: {household.adviser_id ? advisers.get(household.adviser_id)?.name : 'none'}
                      </div>
                    )}
                  </td>
                  <td className={tdCls}>
                    <MonthSelect
                      value={monthKey(l.generation_month)}
                      onChange={(m) => patch([l.id], { generation_month: firstOfMonth(m) })}
                    />
                  </td>
                  <td className={tdNumCls}>{fmtMoney(l.amount_cents)}</td>
                  <td className={tdNumCls}>{fmtMoney(l.gst_cents)}</td>
                  <td className={tdNumCls}>
                    {share ? fmtMoney(share) : '—'}
                    {l.adviser_split_pct !== null && Number(l.adviser_split_pct) > 0 && (
                      <div className="text-xs text-gray-500">{Number(l.adviser_split_pct)}%</div>
                    )}
                  </td>
                </tr>
              )
            })}
            {!shown.length && (
              <tr><td colSpan={showContext ? 11 : 10} className={tdCls + ' text-center text-gray-500 py-6'}>Nothing here.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
