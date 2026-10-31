import type { FeeType } from './fee-type'
import { pctOfCents } from './money'
import { lastOfMonth, lineMonth, type Basis, type MonthKey } from './periods'

/** The fields aggregation needs (a subset of RevenueLine). */
export interface ReportLine {
  amount_cents: number
  gst_cents: number
  fee_type: FeeType | null
  adviser_id: string | null
  adviser_split_pct: number | null
  household_id: string | null
  provider_id: string
  received_date: string
  generation_month: string
}

/** The adviser's share of one line (ex-GST). Ongoing lines and lines with no
 *  adviser or no split yet have none — that money stays with the business. */
export function adviserShareCents(l: ReportLine): number {
  if (l.fee_type !== 'upfront' && l.fee_type !== 'one_off') return 0
  if (!l.adviser_id || l.adviser_split_pct === null) return 0
  return pctOfCents(l.amount_cents, Number(l.adviser_split_pct))
}

export interface Totals {
  count: number
  amount: number // ex GST
  gst: number
  upfront: number
  ongoing: number
  oneOff: number
  unclassified: number
  adviserShare: number
  /** Everything classified that isn't the adviser's — distributed by shareholding. */
  businessShare: number
  unmatchedCount: number
  unmatchedAmount: number
}

export function emptyTotals(): Totals {
  return {
    count: 0, amount: 0, gst: 0, upfront: 0, ongoing: 0, oneOff: 0, unclassified: 0,
    adviserShare: 0, businessShare: 0, unmatchedCount: 0, unmatchedAmount: 0,
  }
}

export function addLine(t: Totals, l: ReportLine): Totals {
  t.count++
  t.amount += l.amount_cents
  t.gst += l.gst_cents
  if (l.fee_type === 'upfront') t.upfront += l.amount_cents
  else if (l.fee_type === 'ongoing') t.ongoing += l.amount_cents
  else if (l.fee_type === 'one_off') t.oneOff += l.amount_cents
  else t.unclassified += l.amount_cents
  if (l.fee_type) {
    const adv = adviserShareCents(l)
    t.adviserShare += adv
    t.businessShare += l.amount_cents - adv
  }
  if (!l.household_id) {
    t.unmatchedCount++
    t.unmatchedAmount += l.amount_cents
  }
  return t
}

export function totals(lines: ReportLine[]): Totals {
  return lines.reduce(addLine, emptyTotals())
}

export function groupTotals<L extends ReportLine>(lines: L[], key: (l: L) => string): Map<string, Totals> {
  const out = new Map<string, Totals>()
  for (const l of lines) {
    const k = key(l)
    addLine(out.get(k) ?? out.set(k, emptyTotals()).get(k)!, l)
  }
  return out
}

export interface AdviserOwed {
  adviserId: string
  upfront: number
  oneOff: number
  /** What the adviser is paid. */
  adviserShare: number
  /** What the business keeps of the same revenue. */
  businessShare: number
  lineCount: number
}

export interface UpfrontsOwed {
  rows: AdviserOwed[]
  /** Upfront / one-off revenue with no adviser yet (unmatched lines). */
  unallocated: { amount: number; count: number }
  /** Lines whose fee type is still undecided — could be upfront. */
  unclassified: { amount: number; count: number }
}

/** What each adviser is owed for upfront / one-off revenue in a set of lines. */
export function upfrontsOwed(lines: ReportLine[]): UpfrontsOwed {
  const byAdviser = new Map<string, AdviserOwed>()
  const unallocated = { amount: 0, count: 0 }
  const unclassified = { amount: 0, count: 0 }
  for (const l of lines) {
    if (l.fee_type === null) {
      unclassified.amount += l.amount_cents
      unclassified.count++
      continue
    }
    if (l.fee_type === 'ongoing') continue
    if (!l.adviser_id) {
      unallocated.amount += l.amount_cents
      unallocated.count++
      continue
    }
    const row =
      byAdviser.get(l.adviser_id) ??
      byAdviser
        .set(l.adviser_id, { adviserId: l.adviser_id, upfront: 0, oneOff: 0, adviserShare: 0, businessShare: 0, lineCount: 0 })
        .get(l.adviser_id)!
    if (l.fee_type === 'upfront') row.upfront += l.amount_cents
    else row.oneOff += l.amount_cents
    const adv = adviserShareCents(l)
    row.adviserShare += adv
    row.businessShare += l.amount_cents - adv
    row.lineCount++
  }
  return {
    rows: [...byAdviser.values()].sort((a, b) => b.adviserShare - a.adviserShare),
    unallocated,
    unclassified,
  }
}

export interface ShareholderRow {
  id: string
  name: string
  share_pct: number
  effective_from: string
  effective_to: string | null
}

export interface ShareholderDistribution {
  rows: { shareholderId: string; name: string; amount: number }[]
  /** Months whose shareholdings in effect don't add to 100% (amount shown is still pro rata). */
  monthsNot100: MonthKey[]
  pool: number
}

/**
 * Distribute the business share by shareholding. Each month on the chosen
 * basis uses the holdings in effect on that month's LAST day, so a change in
 * shareholdings mid-report splits the periods correctly.
 */
export function shareholderDistribution(
  lines: ReportLine[],
  shareholders: ShareholderRow[],
  basis: Basis
): ShareholderDistribution {
  const poolByMonth = new Map<MonthKey, number>()
  for (const l of lines) {
    if (!l.fee_type) continue
    const m = lineMonth(l, basis)
    poolByMonth.set(m, (poolByMonth.get(m) ?? 0) + l.amount_cents - adviserShareCents(l))
  }

  const amounts = new Map<string, number>()
  const monthsNot100: MonthKey[] = []
  let pool = 0
  for (const [month, monthPool] of [...poolByMonth.entries()].sort()) {
    pool += monthPool
    const day = lastOfMonth(month)
    const active = shareholders.filter(
      (s) => s.effective_from <= day && (!s.effective_to || s.effective_to >= day)
    )
    const totalPct = active.reduce((a, s) => a + Number(s.share_pct), 0)
    if (Math.abs(totalPct - 100) > 0.0001) monthsNot100.push(month)
    for (const s of active) {
      amounts.set(s.id, (amounts.get(s.id) ?? 0) + pctOfCents(monthPool, Number(s.share_pct)))
    }
  }

  const names = new Map(shareholders.map((s) => [s.id, s.name]))
  return {
    rows: [...amounts.entries()]
      .map(([shareholderId, amount]) => ({ shareholderId, name: names.get(shareholderId) ?? '—', amount }))
      .sort((a, b) => b.amount - a.amount),
    monthsNot100,
    pool,
  }
}
