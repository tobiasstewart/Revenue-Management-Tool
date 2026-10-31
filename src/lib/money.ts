/**
 * Money is integer CENTS everywhere (DB, engine, reports). Dollars appear only
 * at the edges: parsing statement cells / form inputs and formatting output.
 */

/**
 * Parse a spreadsheet cell or typed amount into cents. Accepts numbers and
 * strings like "$1,234.56", "1234.5", "(12.00)" / "12.00-" / "-12" (negative),
 * "AUD 99", "12.00 CR". Returns null for blanks and anything unparseable.
 */
export function parseAmountToCents(input: unknown): number | null {
  if (input === null || input === undefined) return null
  if (typeof input === 'number') {
    return Number.isFinite(input) ? Math.round(input * 100) : null
  }
  let s = String(input).trim()
  if (!s) return null

  let negative = false
  if (/^\(.*\)$/.test(s)) {
    negative = true
    s = s.slice(1, -1)
  }
  s = s.replace(/\b(AUD|CR)\b/gi, '').replace(/[$,\s]/g, '')
  if (s.endsWith('-')) {
    negative = !negative
    s = s.slice(0, -1)
  }
  if (s.startsWith('-')) {
    negative = !negative
    s = s.slice(1)
  } else if (s.startsWith('+')) {
    s = s.slice(1)
  }
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return null

  const cents = Math.round(parseFloat(s) * 100)
  return negative ? -cents : cents
}

const AUD = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' })
const AUD_WHOLE = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 0,
})

/** "$1,234.56" — amounts that are paid out or reconciled are always 2dp. */
export function fmtMoney(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—'
  return AUD.format(cents / 100)
}

/** "$1,235" — for headline tiles and charts only. */
export function fmtMoneyWhole(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—'
  return AUD_WHOLE.format(cents / 100)
}

/** cents → "1234.56" for form inputs. */
export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return ''
  return (cents / 100).toFixed(2)
}

/** `pct` percent of `cents`, rounded to the cent (half away from zero). */
export function pctOfCents(cents: number, pct: number): number {
  const v = (cents * pct) / 100
  return v < 0 ? -Math.round(-v) : Math.round(v)
}

/** Split a GST-inclusive amount into {ex, gst} at the 10% rate (GST = 1/11). */
export function splitGstInclusive(inclCents: number): { exCents: number; gstCents: number } {
  const gst = inclCents < 0 ? -Math.round(-inclCents / 11) : Math.round(inclCents / 11)
  return { exCents: inclCents - gst, gstCents: gst }
}
