'use client'

import { Fragment, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { FEE_TYPE_LABELS } from '@/lib/fee-type'
import { fmtMoney } from '@/lib/money'
import { dateLabel, monthLabel, type Basis } from '@/lib/periods'
import { adviserShareCents, shareholderDistribution, upfrontsOwed, type Totals } from '@/lib/reports'
import { byId, type Lookups } from '@/lib/data'
import type { RevenueLine } from '@/lib/types'
import { Badge, Empty, Notice, tdCls, tdNumCls, thCls, thNumCls } from '@/components/ui'

export interface Group {
  key: string
  label: string
  totals: Totals
}

/** Revenue by a grouping, with the adviser/business split. */
export function TotalsTable({ groups, grand, firstHeader }: { groups: Group[]; grand: Totals; firstHeader: string }) {
  if (!groups.length) return <Empty>No revenue in this period.</Empty>
  const row = (t: Totals) => (
    <>
      <td className={tdNumCls}>{fmtMoney(t.upfront)}</td>
      <td className={tdNumCls}>{fmtMoney(t.ongoing)}</td>
      <td className={tdNumCls}>{fmtMoney(t.oneOff)}</td>
      <td className={tdNumCls}>{t.unclassified ? <span className="text-amber-700">{fmtMoney(t.unclassified)}</span> : '—'}</td>
      <td className={tdNumCls + ' font-medium'}>{fmtMoney(t.amount)}</td>
      <td className={tdNumCls}>{fmtMoney(t.gst)}</td>
      <td className={tdNumCls}>{fmtMoney(t.adviserShare)}</td>
      <td className={tdNumCls}>{fmtMoney(t.businessShare)}</td>
    </>
  )
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full">
        <thead>
          <tr>
            <th className={thCls}>{firstHeader}</th>
            <th className={thNumCls}>Upfront</th>
            <th className={thNumCls}>Ongoing</th>
            <th className={thNumCls}>One-off</th>
            <th className={thNumCls}>Unclassified</th>
            <th className={thNumCls}>Total ex GST</th>
            <th className={thNumCls}>GST</th>
            <th className={thNumCls}>To advisers</th>
            <th className={thNumCls}>To business</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g, i) => (
            <tr key={g.key} className={i % 2 ? 'bg-row' : 'bg-white'}>
              <td className={tdCls}>{g.label}</td>
              {row(g.totals)}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-semibold bg-brand-light">
            <td className={tdCls}>Total</td>
            {row(grand)}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

/** Upfront + one-off revenue each adviser is owed, expandable to the lines behind it. */
export function UpfrontsOwedTable({ lines, lookups }: { lines: RevenueLine[]; lookups: Lookups }) {
  const [open, setOpen] = useState<string | null>(null)
  const owed = upfrontsOwed(lines)
  const advisers = byId(lookups.advisers)
  const households = byId(lookups.households)
  const providers = byId(lookups.providers)
  const sum = (k: 'upfront' | 'oneOff' | 'adviserShare' | 'businessShare') => owed.rows.reduce((a, r) => a + r[k], 0)

  return (
    <div className="space-y-3">
      {owed.unallocated.count > 0 && (
        <Notice tone="warn">
          {fmtMoney(owed.unallocated.amount)} of upfront / one-off revenue ({owed.unallocated.count} line{owed.unallocated.count > 1 ? 's' : ''}) isn&apos;t matched to a household with an adviser yet, so it isn&apos;t allocated below.
        </Notice>
      )}
      {owed.unclassified.count > 0 && (
        <Notice tone="warn">
          {fmtMoney(owed.unclassified.amount)} ({owed.unclassified.count} line{owed.unclassified.count > 1 ? 's' : ''}) has no fee type yet — some of it may be upfront.
        </Notice>
      )}
      {!owed.rows.length ? <Empty>No upfront or one-off revenue allocated to advisers in this period.</Empty> : (
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr>
                <th className={thCls}>Adviser</th>
                <th className={thNumCls}>Upfront</th>
                <th className={thNumCls}>One-off</th>
                <th className={thNumCls}>Adviser share</th>
                <th className={thNumCls}>Business retains</th>
                <th className={thNumCls}>Lines</th>
              </tr>
            </thead>
            <tbody>
              {owed.rows.map((r, i) => {
                const isOpen = open === r.adviserId
                const detail = isOpen
                  ? lines.filter((l) => l.adviser_id === r.adviserId && (l.fee_type === 'upfront' || l.fee_type === 'one_off'))
                  : []
                return (
                  <Fragment key={r.adviserId}>
                    <tr className={i % 2 ? 'bg-row' : 'bg-white'}>
                      <td className={tdCls}>
                        <button type="button" className="flex items-center gap-1 font-medium text-accent" onClick={() => setOpen(isOpen ? null : r.adviserId)}>
                          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          {advisers.get(r.adviserId)?.name ?? 'Unknown adviser'}
                        </button>
                      </td>
                      <td className={tdNumCls}>{fmtMoney(r.upfront)}</td>
                      <td className={tdNumCls}>{fmtMoney(r.oneOff)}</td>
                      <td className={tdNumCls + ' font-semibold'}>{fmtMoney(r.adviserShare)}</td>
                      <td className={tdNumCls}>{fmtMoney(r.businessShare)}</td>
                      <td className={tdNumCls}>{r.lineCount}</td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={6} className="p-0">
                          <table className="min-w-full bg-white">
                            <tbody>
                              {detail.map((l) => (
                                <tr key={l.id} className="text-xs">
                                  <td className={tdCls + ' pl-8'}>{l.household_id ? households.get(l.household_id)?.name : l.raw_client_name}</td>
                                  <td className={tdCls}>{providers.get(l.provider_id)?.name}</td>
                                  <td className={tdCls}>{l.fee_type ? FEE_TYPE_LABELS[l.fee_type] : ''}</td>
                                  <td className={tdCls}>received {dateLabel(l.received_date)} · for {monthLabel(l.generation_month)}</td>
                                  <td className={tdNumCls}>{fmtMoney(l.amount_cents)}</td>
                                  <td className={tdNumCls}>{Number(l.adviser_split_pct)}%</td>
                                  <td className={tdNumCls + ' font-medium'}>{fmtMoney(adviserShareCents(l))}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="font-semibold bg-brand-light">
                <td className={tdCls}>Total</td>
                <td className={tdNumCls}>{fmtMoney(sum('upfront'))}</td>
                <td className={tdNumCls}>{fmtMoney(sum('oneOff'))}</td>
                <td className={tdNumCls}>{fmtMoney(sum('adviserShare'))}</td>
                <td className={tdNumCls}>{fmtMoney(sum('businessShare'))}</td>
                <td className={tdNumCls}>{owed.rows.reduce((a, r) => a + r.lineCount, 0)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="text-xs text-gray-500">Amounts ex GST. Each line keeps the split in force when it was matched (firm default {lookups.settings ? `${Number(lookups.settings.upfront_adviser_pct)}%` : '60%'} unless an adviser has their own).</p>
    </div>
  )
}

/** The business share, split by shareholding. */
export function ShareholderTable({ lines, lookups, basis }: { lines: RevenueLine[]; lookups: Lookups; basis: Basis }) {
  if (!lookups.shareholders.length) {
    return <Empty>Add shareholders in Settings to see how the business share is distributed.</Empty>
  }
  const d = shareholderDistribution(lines, lookups.shareholders, basis)
  return (
    <div className="space-y-3">
      {d.monthsNot100.length > 0 && (
        <Notice tone="warn">Shareholdings don&apos;t add up to 100% in {d.monthsNot100.map(monthLabel).join(', ')} — check Settings.</Notice>
      )}
      <table className="min-w-full">
        <thead>
          <tr>
            <th className={thCls}>Shareholder</th>
            <th className={thNumCls}>Share of business revenue</th>
          </tr>
        </thead>
        <tbody>
          {d.rows.map((r, i) => (
            <tr key={r.shareholderId} className={i % 2 ? 'bg-row' : 'bg-white'}>
              <td className={tdCls}>
                {r.name}{' '}
                {lookups.shareholders.filter((s) => s.id === r.shareholderId).map((s) => <Badge key={s.id}>{Number(s.share_pct)}%</Badge>)}
              </td>
              <td className={tdNumCls}>{fmtMoney(r.amount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-semibold bg-brand-light">
            <td className={tdCls}>Business share (ongoing + retained upfront)</td>
            <td className={tdNumCls}>{fmtMoney(d.pool)}</td>
          </tr>
        </tfoot>
      </table>
      <p className="text-xs text-gray-500">Revenue before business expenses, ex GST. Holdings are those in effect at each month end.</p>
    </div>
  )
}
