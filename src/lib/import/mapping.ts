import { classifyFeeType, normaliseFeeText, type FeeType } from '../fee-type'
import { parseAmountToCents, splitGstInclusive } from '../money'
import { monthKey, type MonthKey } from '../periods'
import { cellText, parseDateCell, type Cell } from './cells'

/**
 * How a provider's statement maps onto revenue lines. Saved on
 * providers.import_mapping after each import, so the next statement from the
 * same provider pre-fills. Columns are referenced by HEADER TEXT, not
 * position, so a provider adding a column doesn't scramble the mapping.
 */
export interface ImportMapping {
  version: 1
  /** The known statement format this mapping came from (lib/import/formats.ts), if any. */
  formatId?: string
  sheetName: string | null
  /** 0-based header row; null = detect; NO_HEADER_ROW = the sheet has none (columns are "Column 1"…). */
  headerRow: number | null
  columns: Partial<Record<MappedField, string>>
  /** Whether the amount column includes GST. */
  amountBasis: 'ex_gst' | 'incl_gst'
  /** Normalised provider fee text → fee type (learnt from the reviewer). */
  feeTypeValues: Record<string, FeeType>
  /** Applied when a row's fee type can't be determined (e.g. an all-renewals statement). */
  defaultFeeType: FeeType | null
}

export type MappedField =
  | 'clientName'
  | 'clientFirstName'
  | 'clientLastName'
  | 'adviserCode'
  | 'adviserName'
  | 'reference'
  | 'product'
  | 'feeType'
  | 'amount'
  | 'gst'
  | 'period'
  | 'description'

export const MAPPED_FIELDS: { field: MappedField; label: string; required?: boolean; help: string }[] = [
  { field: 'amount', label: 'Amount', required: true, help: 'The fee or commission paid to the business' },
  { field: 'clientName', label: 'Client name', help: 'Used to match the line to a household' },
  { field: 'clientFirstName', label: 'Client first name', help: 'When first and last names are separate columns' },
  { field: 'clientLastName', label: 'Client last name', help: 'When first and last names are separate columns' },
  { field: 'reference', label: 'Account / policy number', help: 'The most reliable matching key' },
  { field: 'adviserCode', label: 'Adviser number / code', help: 'Who the provider paid — decides the adviser split' },
  { field: 'adviserName', label: 'Adviser name', help: 'Used with (or instead of) the adviser number' },
  { field: 'feeType', label: 'Fee / commission type', help: 'Upfront, ongoing, renewal, one-off…' },
  { field: 'gst', label: 'GST', help: 'Leave blank if the statement has no GST column' },
  { field: 'product', label: 'Product', help: 'Platform product, policy type…' },
  { field: 'period', label: 'Fee period / date', help: 'If set, each line takes the month from this column' },
  { field: 'description', label: 'Description', help: 'Any free-text detail worth keeping' },
]

export function emptyMapping(): ImportMapping {
  return {
    version: 1,
    sheetName: null,
    headerRow: null,
    columns: {},
    amountBasis: 'ex_gst',
    feeTypeValues: {},
    defaultFeeType: null,
  }
}

/** headerRow value for a sheet with no title row: every row is data. */
export const NO_HEADER_ROW = -1

function norm(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

// Priority-ordered header keywords per field.
const HEADER_KEYWORDS: Record<MappedField, string[]> = {
  gst: ['gst amount', 'gst'],
  amount: [
    'commission paid excluding gst', 'amount excluding gst', 'amount ex gst', 'amount excl gst',
    'excluding gst', 'ex gst', 'excl gst', 'payable amt net', 'net amount', 'commission amount', 'commission paid',
    'fee amount', 'adviser fee', 'payment', 'commission', 'amount', 'fee', 'gross amount', 'total',
  ],
  adviserCode: [
    'adviser number', 'adviser no', 'adviser code', 'adviser id', 'adviser sub id', 'adviser sales code',
    'advisor number', 'advisor code', 'agent number', 'agent code',
  ],
  adviserName: ['adviser name', 'advisor name', 'agent name', 'adviser', 'advisor'],
  clientFirstName: ['client first name', 'first name', 'given name', 'firstname'],
  clientLastName: ['client last name', 'last name', 'surname', 'family name', 'lastname'],
  reference: [
    'account number', 'account no', 'policy number', 'policy no', 'policy id', 'portfolio number', 'portfolio no',
    'bond number', 'client number', 'client id', 'member number', 'investor number', 'customer number',
    'payer id', 'reference', 'policy', 'account', 'portfolio',
  ],
  clientName: [
    'client name', 'investor name', 'account name', 'member name', 'policy owner', 'policy holder',
    'policyholder', 'life insured', 'primary owner', 'customer name', 'payer name', 'mailing name',
    'client', 'investor', 'owner', 'name',
  ],
  feeType: ['fee type', 'commission type', 'transaction type', 'trans type', 'payment type', 'type'],
  product: ['benefit', 'product name', 'product', 'plan'],
  period: ['fee period', 'period', 'fee date', 'transaction date', 'statement date', 'effective date', 'date', 'month'],
  description: ['description', 'details', 'narration', 'comment', 'comments'],
}

// Headers that contain a field's keyword but are never that field — "Commission
// type" is not an amount, "Benefit Start Date" is not the fee period.
const HEADER_EXCLUDE: Partial<Record<MappedField, RegExp>> = {
  amount: /\b(type|group|percentage|pct|rate|premium|clawback|structure|date|frequency|number|name|units|balance|withheld)\b|%/,
  gst: /\b(excluding|excl|ex|including|incl|inc|total)\b/,
  // "Date Paid" is when the provider paid, not the month the fee was earned;
  // policy start/adjustment/valuation dates aren't fee periods either.
  period: /\b(start|commencement|birth|dob|expiry|end|paid|risk|adjustment|val|valuation|updated)\b/,
  clientName: /\b(first|last|surname|given|company|product|adviser|advisor|agent|scheme|fund|benefit|plan|platform|dealer|licensee|fee|entity)\b/,
  adviserCode: /\bname\b/,
  adviserName: /\b(code|id|number|no|dealer)\b/,
  reference: /\b(adviser|advisor|agent|statement)\b/,
  product: /\b(start|date|type)\b/,
  feeType: /\b(product|premium|benefit|arrangement)\b/,
}

const FIELD_ORDER: MappedField[] = [
  'gst', 'amount', 'adviserCode', 'adviserName', 'reference', 'clientFirstName', 'clientLastName', 'clientName',
  'feeType', 'product', 'period', 'description',
]

const NUMERIC = /^[-(]?\$?-?[\d,]*\.?\d+\)?$|^\d{1,2}\/\d{1,2}\/\d{2,4}$|^\d{4}-\d{2}-\d{2}$/

/** A row of DATA, not titles: two or more numbers / amounts / dates. */
function looksLikeData(row: Cell[]): boolean {
  return row.filter((c) => typeof c === 'number' || (typeof c === 'string' && NUMERIC.test(c.trim()))).length >= 2
}

/**
 * Header row = the row in the first 30 that looks most like headers (rows of
 * numbers never qualify). A sheet whose first row is already data — Ezidebit,
 * Generation Life — has none: NO_HEADER_ROW.
 */
export function detectHeaderRow(rows: Cell[][]): number {
  const keywords = new Set(Object.values(HEADER_KEYWORDS).flat())
  let best = -1
  let bestScore = 1
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    if (looksLikeData(rows[i])) continue
    const cells = rows[i].map((c) => (typeof c === 'string' ? norm(c) : ''))
    const score = cells.filter((c) => c && (keywords.has(c) || [...keywords].some((k) => k.length > 3 && c.includes(k)))).length
    if (score > bestScore) {
      best = i
      bestScore = score
    }
  }
  if (best >= 0) return best
  const first = rows.findIndex((r) => r.some((c) => cellText(c) !== ''))
  if (first >= 0 && looksLikeData(rows[first])) return NO_HEADER_ROW
  const firstTexty = rows.findIndex((r) => !looksLikeData(r) && r.filter((c) => typeof c === 'string').length >= 3)
  return firstTexty >= 0 ? firstTexty : 0
}

/** "Payment amount inc GST" → the amounts include GST. */
export function guessAmountBasis(amountHeader: string | undefined): ImportMapping['amountBasis'] {
  const n = norm(amountHeader ?? '')
  return /\b(inc|incl|including)\b.*\bgst\b|\bgross\b.*\bgst\b/.test(n) && !/\b(ex|excl|excluding)\b/.test(n)
    ? 'incl_gst'
    : 'ex_gst'
}

/** Guess a column for each field: exact header matches first, then "contains". */
export function guessColumns(headers: string[]): Partial<Record<MappedField, string>> {
  const out: Partial<Record<MappedField, string>> = {}
  const used = new Set<string>()
  const normed = headers.map((h) => ({ h, n: norm(h) })).filter((x) => x.n)
  for (const pass of ['exact', 'contains'] as const) {
    for (const field of FIELD_ORDER) {
      if (out[field]) continue
      for (const kw of HEADER_KEYWORDS[field]) {
        const hit = normed.find(
          (x) =>
            !used.has(x.h) &&
            (pass === 'exact' ? x.n === kw : x.n.includes(kw) && !HEADER_EXCLUDE[field]?.test(x.n))
        )
        if (hit) {
          out[field] = hit.h
          used.add(hit.h)
          break
        }
      }
    }
  }
  return out
}

export interface ParsedLine {
  /** 1-based row number in the sheet, for tracing back to the statement. */
  rowNumber: number
  clientName: string
  reference: string
  adviserCode: string
  adviserName: string
  product: string
  rawFeeType: string
  feeType: FeeType | null
  description: string
  amountCents: number
  gstCents: number
  /** From the period column, else null (= the statement's revenue month). */
  generationMonth: MonthKey | null
  raw: Record<string, Cell>
}

export interface ApplyResult {
  headers: string[]
  lines: ParsedLine[]
  skipped: number
  errors: { rowNumber: number; message: string }[]
}

export function headersAt(rows: Cell[][], headerRow: number): string[] {
  if (headerRow === NO_HEADER_ROW) {
    const width = rows.reduce((w, r) => Math.max(w, r?.length ?? 0), 0)
    return Array.from({ length: width }, (_, i) => `Column ${i + 1}`)
  }
  const seen = new Map<string, number>()
  return (rows[headerRow] ?? []).map((c, i) => {
    const base = cellText(c) || `Column ${i + 1}`
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    return n > 1 ? `${base} (${n})` : base
  })
}

const TOTAL_ROW = /^(grand )?(sub ?)?total\b/i
// Statements that print the adviser as a label: "Adviser: Garth Bailo".
const ADVISER_LABEL = /^(adviser|advisor|agent)( name)?\s*[:\-–]\s*/i

/** Turn sheet rows into revenue lines under a mapping. */
export function applyMapping(rows: Cell[][], mapping: ImportMapping): ApplyResult {
  const headerRow = mapping.headerRow ?? detectHeaderRow(rows)
  const headers = headersAt(rows, headerRow)
  const col = (f: MappedField) => {
    const h = mapping.columns[f]
    return h ? headers.indexOf(h) : -1
  }
  const idx = Object.fromEntries(FIELD_ORDER.map((f) => [f, col(f)])) as Record<MappedField, number>

  const result: ApplyResult = { headers, lines: [], skipped: 0, errors: [] }
  if (idx.amount < 0) {
    result.errors.push({ rowNumber: headerRow + 1, message: 'Choose the amount column' })
    return result
  }

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] ?? []
    const rowNumber = r + 1
    const get = (f: MappedField) => (idx[f] >= 0 ? row[idx[f]] ?? null : null)

    if (row.every((c) => c === null || cellText(c) === '')) continue
    if (row.slice(0, 4).some((c) => typeof c === 'string' && TOTAL_ROW.test(c.trim()))) {
      result.skipped++
      continue
    }

    const amountCell = get('amount')
    if (amountCell === null || cellText(amountCell) === '') {
      result.skipped++
      continue
    }
    const amount = parseAmountToCents(amountCell)
    if (amount === null) {
      result.errors.push({ rowNumber, message: `Amount "${cellText(amountCell)}" isn't a number` })
      continue
    }
    if (amount === 0) {
      result.skipped++
      continue
    }

    const gstCell = get('gst')
    const gstParsed = gstCell === null ? null : parseAmountToCents(gstCell)
    let amountCents: number
    let gstCents: number
    if (mapping.amountBasis === 'incl_gst') {
      if (gstParsed !== null) {
        gstCents = gstParsed
        amountCents = amount - gstParsed
      } else {
        ;({ exCents: amountCents, gstCents } = splitGstInclusive(amount))
      }
    } else {
      amountCents = amount
      gstCents = gstParsed ?? 0
    }

    const rawFeeType = cellText(get('feeType'))
    const description = cellText(get('description'))
    const product = cellText(get('product'))
    const learnt = mapping.feeTypeValues[normaliseFeeText(rawFeeType)]
    const feeType =
      learnt ??
      classifyFeeType(rawFeeType) ??
      (idx.feeType < 0 ? classifyFeeType(description) ?? classifyFeeType(product) : null) ??
      mapping.defaultFeeType

    const periodDate = parseDateCell(get('period'))

    const raw: Record<string, Cell> = {}
    headers.forEach((h, i) => {
      if (row[i] !== null && row[i] !== undefined) raw[h] = row[i]
    })

    const fullName = cellText(get('clientName'))
    const first = cellText(get('clientFirstName'))
    const last = cellText(get('clientLastName'))

    result.lines.push({
      rowNumber,
      clientName: fullName || [first, last].filter(Boolean).join(' '),
      adviserCode: cellText(get('adviserCode')),
      adviserName: cellText(get('adviserName')).replace(ADVISER_LABEL, ''),
      reference: cellText(get('reference')),
      product,
      rawFeeType,
      feeType,
      description,
      amountCents,
      gstCents,
      generationMonth: periodDate ? monthKey(periodDate) : null,
      raw,
    })
  }
  return result
}

/** Distinct fee-type texts in the mapped column, for the value-mapping table. */
export function distinctFeeTexts(rows: Cell[][], mapping: ImportMapping): string[] {
  const headerRow = mapping.headerRow ?? detectHeaderRow(rows)
  const headers = headersAt(rows, headerRow)
  const i = mapping.columns.feeType ? headers.indexOf(mapping.columns.feeType) : -1
  if (i < 0) return []
  // Only rows that carry an amount — footer rows like "Balance brought forward"
  // sit in the type column but aren't fees.
  const a = mapping.columns.amount ? headers.indexOf(mapping.columns.amount) : -1
  const out = new Map<string, string>()
  for (let r = headerRow + 1; r < rows.length; r++) {
    if (a >= 0 && cellText(rows[r]?.[a]) === '') continue
    const t = cellText(rows[r]?.[i])
    const n = normaliseFeeText(t)
    if (n && !out.has(n)) out.set(n, t)
  }
  return [...out.values()]
}
