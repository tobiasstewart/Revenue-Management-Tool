import { lastOfMonth, monthKey, addMonths, type IsoDate, type MonthKey } from './periods'
import {
  shareholderDistribution, totals, upfrontsOwed,
  type ReportLine, type ShareholderRow, type Totals,
} from './reports'

/**
 * Month-end close — what has to be true before a RECEIVED month's adviser and
 * shareholder payouts can be settled, and the snapshot frozen when it is.
 * Pure: the page loads the rows, these functions decide.
 */

export type StatementFrequency = 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'irregular'

export const FREQUENCY_LABELS: Record<StatementFrequency, string> = {
  weekly: 'Weekly',
  fortnightly: 'Fortnightly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  irregular: 'Irregular / as needed',
}

/** The fewest statements a provider of this frequency should send in a month (null = no fixed number). */
export function expectedStatements(freq: StatementFrequency): number | null {
  return { weekly: 4, fortnightly: 2, monthly: 1, quarterly: null, irregular: null }[freq]
}

/** Within this many cents a deposit counts as matching the statement (provider rounding). */
export const RECONCILE_TOLERANCE_CENTS = 2

export type Reconciliation = 'ok' | 'differs' | 'no_deposit'

export function reconcile(inclCents: number, depositCents: number | null): { status: Reconciliation; diff: number | null } {
  if (depositCents === null) return { status: 'no_deposit', diff: null }
  const diff = depositCents - inclCents
  return { status: Math.abs(diff) <= RECONCILE_TOLERANCE_CENTS ? 'ok' : 'differs', diff }
}

/** A statement with its line totals (statements ⨝ statement_summaries). */
export interface CloseStatement {
  id: string
  provider_id: string
  received_date: IsoDate
  deposit_amount_cents: number | null
  status: 'draft' | 'finalised'
  line_count: number
  amount_cents: number
  gst_cents: number
}

export interface CloseProvider {
  id: string
  name: string
  is_active: boolean
  statement_frequency: StatementFrequency
}

export type ChecklistStatus = 'ok' | 'short' | 'missing' | 'overdue' | 'not_expected'

export interface ChecklistRow {
  provider: CloseProvider
  expected: number | null
  statements: (CloseStatement & { inclCents: number; reconciliation: Reconciliation; diff: number | null })[]
  inclCents: number
  depositCents: number
  /** Latest statement received on or before the month's end, any month. */
  lastReceived: IsoDate | null
  status: ChecklistStatus
}

/**
 * One row per provider: what arrived in the month against what its frequency
 * says should have. `recent` = statements from the months before (for "last
 * received" and the quarterly check); inactive providers with nothing this
 * month are left out.
 */
export function statementChecklist(
  month: MonthKey,
  providers: CloseProvider[],
  inMonth: CloseStatement[],
  recent: CloseStatement[]
): ChecklistRow[] {
  const end = lastOfMonth(month)
  const quarterStart = `${addMonths(month, -2)}-01`
  const rows: ChecklistRow[] = []
  for (const provider of providers) {
    const mine = inMonth
      .filter((s) => s.provider_id === provider.id)
      .sort((a, b) => a.received_date.localeCompare(b.received_date))
    if (!provider.is_active && !mine.length) continue
    const statements = mine.map((s) => {
      const inclCents = s.amount_cents + s.gst_cents
      const { status: reconciliation, diff } = reconcile(inclCents, s.deposit_amount_cents)
      return { ...s, inclCents, reconciliation, diff }
    })
    const earlier = recent.filter((s) => s.provider_id === provider.id && s.received_date <= end)
    const lastReceived = [...mine, ...earlier].map((s) => s.received_date).sort().pop() ?? null
    const expected = expectedStatements(provider.statement_frequency)
    let status: ChecklistStatus
    if (expected !== null) status = mine.length >= expected ? 'ok' : mine.length ? 'short' : 'missing'
    else if (provider.statement_frequency === 'quarterly') status = lastReceived && lastReceived >= quarterStart ? 'ok' : 'overdue'
    else status = mine.length ? 'ok' : 'not_expected'
    rows.push({
      provider,
      expected,
      statements,
      inclCents: statements.reduce((a, s) => a + s.inclCents, 0),
      depositCents: statements.reduce((a, s) => a + (s.deposit_amount_cents ?? 0), 0),
      lastReceived,
      status,
    })
  }
  const order: Record<ChecklistStatus, number> = { missing: 0, short: 1, overdue: 2, ok: 3, not_expected: 4 }
  return rows.sort((a, b) => order[a.status] - order[b.status] || a.provider.name.localeCompare(b.provider.name))
}

export interface CountAmount {
  count: number
  amount: number
}

/** Things that make the payout figures WRONG — the month can't close with any. */
export interface CloseBlockers {
  /** No fee type: could be upfront, so the adviser's share is unknown. */
  unclassified: CountAmount
  /** Upfront / one-off with nobody to pay. */
  upfrontNoAdviser: CountAmount
}

export function closeBlockers(lines: ReportLine[]): CloseBlockers {
  const b: CloseBlockers = { unclassified: { count: 0, amount: 0 }, upfrontNoAdviser: { count: 0, amount: 0 } }
  for (const l of lines) {
    if (l.fee_type === null) {
      b.unclassified.count++
      b.unclassified.amount += l.amount_cents
    } else if (l.fee_type !== 'ongoing' && !l.adviser_id) {
      b.upfrontNoAdviser.count++
      b.upfrontNoAdviser.amount += l.amount_cents
    }
  }
  return b
}

export function hasBlockers(b: CloseBlockers): boolean {
  return b.unclassified.count > 0 || b.upfrontNoAdviser.count > 0
}

export type WarningKey = 'statements' | 'reconciliation' | 'unmatched' | 'shareholders' | 'empty'

export interface CloseWarning {
  key: WarningKey
  message: string
}

/**
 * Things worth a second look that DON'T change who is paid what for the
 * lines already in — each must be acknowledged before closing.
 */
export function closeWarnings(
  lines: ReportLine[],
  checklist: ChecklistRow[],
  shareholders: ShareholderRow[],
  month: MonthKey
): CloseWarning[] {
  const out: CloseWarning[] = []
  if (!lines.length) out.push({ key: 'empty', message: 'No revenue has been recorded as received this month.' })

  const behind = checklist.filter((r) => r.status === 'missing' || r.status === 'short' || r.status === 'overdue')
  if (behind.length) {
    out.push({
      key: 'statements',
      message: `Expected statements not in yet: ${behind
        .map((r) => (r.expected ? `${r.provider.name} (${r.statements.length} of ${r.expected})` : `${r.provider.name} (none this quarter)`))
        .join(', ')}. Anything arriving later goes in the month it's received.`,
    })
  }

  const all = checklist.flatMap((r) => r.statements)
  const differs = all.filter((s) => s.reconciliation === 'differs')
  const noDeposit = all.filter((s) => s.reconciliation === 'no_deposit')
  if (differs.length || noDeposit.length) {
    out.push({
      key: 'reconciliation',
      message: [
        differs.length && `${differs.length} statement${differs.length > 1 ? "s don't" : " doesn't"} match the bank deposit`,
        noDeposit.length && `${noDeposit.length} ${noDeposit.length > 1 ? 'have' : 'has'} no deposit recorded`,
      ].filter(Boolean).join('; ') + '.',
    })
  }

  const unmatched = lines.filter((l) => !l.household_id)
  if (unmatched.length) {
    out.push({
      key: 'unmatched',
      message: `${unmatched.length} line${unmatched.length > 1 ? 's' : ''} aren't matched to a household (ongoing revenue, or the statement names the adviser — payouts are unaffected, client reports are).`,
    })
  }

  const dist = shareholderDistribution(lines, shareholders, 'received')
  const day = lastOfMonth(month)
  const active = shareholders.filter((s) => s.effective_from <= day && (!s.effective_to || s.effective_to >= day))
  if (!active.length) {
    out.push({ key: 'shareholders', message: 'No shareholders are set up for this month — the business share has no one to go to.' })
  } else if (dist.monthsNot100.length || Math.abs(active.reduce((a, s) => a + Number(s.share_pct), 0) - 100) > 0.0001) {
    out.push({ key: 'shareholders', message: 'Shareholdings in effect at month end don\'t add up to 100%.' })
  }
  return out
}

/** The figures frozen at close — what was paid. Stored in month_closes.snapshot. */
export interface CloseSnapshot {
  version: 1
  month: MonthKey
  totals: Totals
  advisers: { adviserId: string; name: string; upfront: number; oneOff: number; adviserShare: number; lineCount: number }[]
  shareholders: { shareholderId: string; name: string; sharePct: number; amount: number }[]
  shareholderPool: number
  statements: { id: string; provider: string; receivedDate: IsoDate; inclCents: number; depositCents: number | null }[]
  /** Warnings the closer acknowledged. */
  acknowledged: string[]
}

export function buildSnapshot(args: {
  month: MonthKey
  lines: ReportLine[]
  checklist: ChecklistRow[]
  shareholders: ShareholderRow[]
  adviserNames: Map<string, string>
  acknowledged: CloseWarning[]
}): CloseSnapshot {
  const { month, lines, checklist, shareholders, adviserNames, acknowledged } = args
  const owed = upfrontsOwed(lines)
  const dist = shareholderDistribution(lines, shareholders, 'received')
  const pct = new Map(shareholders.map((s) => [s.id, Number(s.share_pct)]))
  return {
    version: 1,
    month,
    totals: totals(lines),
    advisers: owed.rows.map((r) => ({
      adviserId: r.adviserId,
      name: adviserNames.get(r.adviserId) ?? '—',
      upfront: r.upfront,
      oneOff: r.oneOff,
      adviserShare: r.adviserShare,
      lineCount: r.lineCount,
    })),
    shareholders: dist.rows.map((r) => ({ shareholderId: r.shareholderId, name: r.name, sharePct: pct.get(r.shareholderId) ?? 0, amount: r.amount })),
    shareholderPool: dist.pool,
    statements: checklist.flatMap((r) => r.statements.map((s) => ({
      id: s.id, provider: r.provider.name, receivedDate: s.received_date, inclCents: s.inclCents, depositCents: s.deposit_amount_cents,
    }))),
    acknowledged: acknowledged.map((w) => w.message),
  }
}

/**
 * Where today's figures for a closed month differ from what was paid — e.g.
 * shareholdings edited afterwards. Line-level figures are locked by the
 * database, so these should normally be empty.
 */
export function snapshotDrift(snapshot: CloseSnapshot, current: CloseSnapshot): string[] {
  const out: string[] = []
  const t = (k: keyof Totals, label: string) => {
    if (snapshot.totals[k] !== current.totals[k]) out.push(label)
  }
  t('amount', 'Revenue')
  t('adviserShare', 'Owed to advisers')
  t('businessShare', 'Business share')
  const paid = new Map(snapshot.shareholders.map((s) => [s.shareholderId, s.amount]))
  const now = new Map(current.shareholders.map((s) => [s.shareholderId, s.amount]))
  const ids = new Set([...paid.keys(), ...now.keys()])
  if ([...ids].some((id) => paid.get(id) !== now.get(id))) out.push('Shareholder split')
  return out
}

/** The month the close page opens on: last month (payouts happen early in the next). */
export function defaultCloseMonth(today: IsoDate): MonthKey {
  return addMonths(monthKey(today), -1)
}
