/**
 * Dates are handled as ISO strings ('YYYY-MM-DD', months as 'YYYY-MM') —
 * never Date objects — so nothing shifts with the browser's time zone.
 * Australian financial years run 1 July – 30 June and are named by the year
 * they END in (FY2027 = 1 Jul 2026 – 30 Jun 2027), shown as "FY2026–27".
 */

export type MonthKey = string // 'YYYY-MM'
export type IsoDate = string // 'YYYY-MM-DD'

/** The two reporting bases. */
export type Basis = 'received' | 'generated'

export const BASIS_LABELS: Record<Basis, string> = {
  received: 'Received in bank',
  generated: 'Revenue generated',
}

export const BASIS_HELP: Record<Basis, string> = {
  received: 'By the date the money reached the bank account — the basis advisers and shareholders are paid on.',
  generated: 'By the month the revenue was earned (e.g. platform fees paid in September for August) — the tax and audit basis.',
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function parts(key: string): { y: number; m: number } {
  const [y, m] = key.split('-').map(Number)
  return { y, m }
}

export function monthKey(date: IsoDate | MonthKey): MonthKey {
  return date.slice(0, 7)
}

export function firstOfMonth(key: MonthKey | IsoDate): IsoDate {
  return `${monthKey(key)}-01`
}

export function daysInMonth(key: MonthKey): number {
  const { y, m } = parts(key)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

export function lastOfMonth(key: MonthKey | IsoDate): IsoDate {
  const k = monthKey(key)
  return `${k}-${pad(daysInMonth(k))}`
}

export function addMonths(key: MonthKey | IsoDate, n: number): MonthKey {
  const { y, m } = parts(key)
  const idx = y * 12 + (m - 1) + n
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`
}

/** "Aug 2026" */
export function monthLabel(key: MonthKey | IsoDate): string {
  const { y, m } = parts(key)
  return `${MONTHS[m - 1]} ${y}`
}

/** "15 Sep 2026" */
export function dateLabel(date: IsoDate | null | undefined): string {
  if (!date) return '—'
  const [y, m, d] = date.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}

/** FY (by its ending year) containing a month or date. */
export function fyOf(key: MonthKey | IsoDate): number {
  const { y, m } = parts(key)
  return m >= 7 ? y + 1 : y
}

/** "FY2026–27" for fy = 2027 */
export function fyLabel(fy: number): string {
  return `FY${fy - 1}–${String(fy).slice(2)}`
}

/** Inclusive month list. */
export function monthsBetween(from: MonthKey | IsoDate, to: MonthKey | IsoDate): MonthKey[] {
  const out: MonthKey[] = []
  let k = monthKey(from)
  const end = monthKey(to)
  while (k <= end) {
    out.push(k)
    k = addMonths(k, 1)
  }
  return out
}

/** Today's date in Sydney, so "this month" doesn't flip a day early or late. */
export function todayIso(now: Date = new Date()): IsoDate {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/** Revenue month for money received on `receivedDate` from a provider whose
 *  fees relate to `offsetMonths` months earlier (0 = same month, -1 = prior). */
export function generationMonthFor(receivedDate: IsoDate, offsetMonths: number): MonthKey {
  return addMonths(receivedDate, offsetMonths)
}

/** An inclusive date range. On the generated basis only its months matter. */
export interface Period {
  from: IsoDate
  to: IsoDate
}

export function periodForMonth(key: MonthKey): Period {
  return { from: firstOfMonth(key), to: lastOfMonth(key) }
}

export function periodForFy(fy: number): Period {
  return { from: `${fy - 1}-07-01`, to: `${fy}-06-30` }
}

export function periodLabel(p: Period): string {
  if (p.from === firstOfMonth(p.from) && p.to === lastOfMonth(p.from)) return monthLabel(p.from)
  const fy = fyOf(p.from)
  if (p.from === `${fy - 1}-07-01` && p.to === `${fy}-06-30`) return fyLabel(fy)
  return `${dateLabel(p.from)} – ${dateLabel(p.to)}`
}

/**
 * Does a line fall inside the period on the given basis? Received: its bank
 * date is within [from, to]. Generated: its revenue month is one of the
 * period's months (a custom 15 Sep – 14 Oct range covers Sep and Oct).
 */
export function inPeriod(
  line: { received_date: IsoDate; generation_month: IsoDate },
  basis: Basis,
  p: Period
): boolean {
  if (basis === 'received') return line.received_date >= p.from && line.received_date <= p.to
  const m = firstOfMonth(line.generation_month)
  return m >= firstOfMonth(p.from) && m <= firstOfMonth(p.to)
}

/** The month a line belongs to on the given basis. */
export function lineMonth(line: { received_date: IsoDate; generation_month: IsoDate }, basis: Basis): MonthKey {
  return monthKey(basis === 'received' ? line.received_date : line.generation_month)
}
