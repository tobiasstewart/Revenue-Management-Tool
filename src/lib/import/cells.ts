import type { IsoDate } from '../periods'

/** A parsed spreadsheet cell: text, a number, or blank. Dates arrive as ISO text. */
export type Cell = string | number | null

export interface ParsedSheet {
  name: string
  rows: Cell[][]
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function isoFromUtcDate(d: Date): IsoDate {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/**
 * Normalise an exceljs cell value. exceljs hands back Dates (UTC midnight for
 * date cells), rich text runs, formulas ({formula, result}), hyperlinks
 * ({text, hyperlink}) and error objects.
 */
export function normaliseExcelValue(v: unknown): Cell {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') return v.trim() || null
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : isoFromUtcDate(v)
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (Array.isArray(o.richText)) {
      return (o.richText as { text?: string }[]).map((r) => r.text ?? '').join('').trim() || null
    }
    if ('result' in o) return normaliseExcelValue(o.result)
    if ('formula' in o || 'sharedFormula' in o) return null
    if ('text' in o) return normaliseExcelValue(o.text)
    if ('error' in o) return null
  }
  return null
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
}

function valid(y: number, m: number, d: number): IsoDate | null {
  if (y < 100) y += 2000
  if (m < 1 || m > 12 || d < 1) return null
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate()
  if (d > dim) return null
  return `${y}-${pad(m)}-${pad(d)}`
}

/**
 * Parse a date cell. Australian day-first order for slashed dates. Month-only
 * values ("Aug 2026", "08/2026") resolve to the 1st. Excel serial numbers are
 * accepted in a sane range (1990–2100). Returns null when not a date.
 */
export function parseDateCell(v: Cell): IsoDate | null {
  if (v === null) return null
  if (typeof v === 'number') {
    if (v < 32874 || v > 73051) return null // 1990-01-01 .. 2100-01-01
    return isoFromUtcDate(new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000))
  }
  const s = v.trim().toLowerCase()
  let m: RegExpMatchArray | null

  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return valid(+m[1], +m[2], +m[3])
  if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/))) return valid(+m[3], +m[2], +m[1])
  if ((m = s.match(/^(\d{1,2})[\s-]([a-z]+)[\s-,]+(\d{2,4})$/)) && MONTHS[m[2]]) {
    return valid(+m[3], MONTHS[m[2]], +m[1])
  }
  if ((m = s.match(/^([a-z]+)[\s-,]+(\d{4})$/)) && MONTHS[m[1]]) return valid(+m[2], MONTHS[m[1]], 1)
  if ((m = s.match(/^(\d{1,2})[/-](\d{4})$/))) return valid(+m[2], +m[1], 1)
  if ((m = s.match(/^(\d{4})[/-](\d{1,2})$/))) return valid(+m[1], +m[2], 1)
  return null
}

export function cellText(v: Cell | undefined): string {
  if (v === null || v === undefined) return ''
  return String(v).trim()
}
