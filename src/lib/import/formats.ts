import type { FeeType } from '../fee-type'
import type { ProviderType } from '../types'
import { cellText, parseDateCell, type Cell, type ParsedSheet } from './cells'
import { detectHeaderRow, emptyMapping, headersAt, NO_HEADER_ROW, type ImportMapping, type MappedField } from './mapping'

/**
 * Statement layouts we've seen from real providers. When an uploaded file
 * matches one, the wizard pre-fills its mapping from here instead of guessing
 * from header text — the only way to read headerless files (Ezidebit,
 * Generation Life) and provider codes ("A" = adviser service fee) correctly.
 *
 * Every entry is pinned by a synthetic-data test in
 * src/lib/__tests__/statement-formats.test.ts (real headers, invented people).
 * Assumptions Toby hasn't confirmed are marked UNCONFIRMED.
 */
export interface StatementFormat {
  id: string
  /** Shown in the wizard: "Recognised: …". */
  label: string
  /** The provider the layout belongs to, for setting up the provider. */
  provider: string
  providerType: ProviderType
  /** Header row to use, or NO_HEADER_ROW. null = detectHeaderRow finds it. */
  headerRow: number | null
  /** Normalised headers that must ALL be present (header formats). */
  requiredHeaders?: string[]
  /** Content test for headerless formats: the first few data rows. */
  matchesRows?: (rows: Cell[][]) => boolean
  columns: Partial<Record<MappedField, string>>
  amountBasis: ImportMapping['amountBasis']
  /** Provider codes → fee type, merged under anything learnt for the provider. */
  feeTypeValues?: Record<string, FeeType>
  defaultFeeType?: FeeType | null
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

const isAmount = (c: Cell) => typeof c === 'number' || /^-?\$?[\d,]*\.\d{2}$/.test(cellText(c))
const firstDataRows = (rows: Cell[][]) => rows.filter((r) => r.some((c) => cellText(c) !== '')).slice(0, 5)

export const STATEMENT_FORMATS: StatementFormat[] = [
  {
    id: 'acenda-commission-csv',
    label: 'Acenda commission statement (CSV)',
    provider: 'Acenda',
    providerType: 'insurer',
    headerRow: null,
    requiredHeaders: ['adviser number', 'commission paid excluding gst', 'commission type', 'policy number'],
    columns: {
      gst: 'GST', amount: 'Commission paid excluding GST', adviserCode: 'Adviser number', adviserName: 'Adviser name',
      reference: 'Policy number', clientFirstName: 'Client first name', clientLastName: 'Client last name',
      feeType: 'Commission type', product: 'Benefit', period: 'Statement date',
    },
    amountBasis: 'ex_gst',
  },
  {
    id: 'clearview-commstmt-csv',
    label: 'ClearView commission statement (CSV)',
    provider: 'ClearView',
    providerType: 'insurer',
    headerRow: null,
    requiredHeaders: ['comm payable amt net1', 'comm payable amt gst', 'trans type', 'policy no'],
    columns: {
      amount: 'Comm_Payable_Amt_Net1', gst: 'Comm_Payable_Amt_GST', adviserCode: 'Adviser_Sales_Code1',
      adviserName: 'Adviser_name', reference: 'Policy_No', clientName: 'Life_Insured_Name', product: 'Benefit',
      // Trans_Type (Renewal / New Business) is the fee type. NOT Comm_Type —
      // it says "Upfront" on renewal rows too (it's the commission structure).
      feeType: 'Trans_Type', period: 'Comm_Payment_Date', description: 'Product',
    },
    amountBasis: 'ex_gst',
  },
  {
    id: 'tal-commstmt-csv',
    label: 'TAL commission statement (CSV, includes Asteron)',
    provider: 'TAL',
    providerType: 'insurer',
    headerRow: null,
    requiredHeaders: ['policy number', 'entity name', 'life insured name', 'commission type', 'total commission', 'adviser sub id'],
    columns: {
      amount: 'Total Commission', adviserCode: 'Adviser sub ID', adviserName: 'Adviser sub ID Name',
      reference: 'Policy Number', clientName: 'Life Insured Name', feeType: 'Commission Type', product: 'Product Name',
      description: 'Entity Name',
    },
    // No GST column; the total matches the PDF's account summary. UNCONFIRMED
    // whether TAL pays GST on top.
    amountBasis: 'ex_gst',
    // RC = Asteron renewal commission — UNCONFIRMED.
    feeTypeValues: { renew: 'ongoing', rc: 'ongoing' },
  },
  {
    id: 'cfs-asf-csv',
    label: 'CFS / Avanteos adviser service fee file (CSV)',
    provider: 'CFS',
    providerType: 'platform',
    headerRow: null,
    requiredHeaders: ['record', 'payment amount inc gst', 'payment gst amount', 'payment type', 'account number'],
    columns: {
      amount: 'Payment amount inc GST', gst: 'Payment GST Amount', adviserCode: 'Adviser Code', adviserName: 'Adviser name',
      reference: 'Account Number', clientName: 'Account mailing name', feeType: 'Payment type', product: 'Product Name',
      description: 'APIR Code',
    },
    amountBasis: 'incl_gst',
    // From the matching PDF: A rows = "Adviser Service Fee", C rows = "Upfront Commission".
    feeTypeValues: { a: 'ongoing', c: 'upfront' },
  },
  {
    id: 'australian-unity-asf-xlsx',
    label: 'Australian Unity adviser service fee by portfolio (Excel)',
    provider: 'Australian Unity',
    providerType: 'investment_bond',
    headerRow: null,
    requiredHeaders: ['adviser code', 'primary owner', 'portfolio no', 'fee name', 'total'],
    columns: {
      amount: 'Total', adviserCode: 'Adviser Code', adviserName: 'Adviser Name', clientName: 'Primary Owner',
      reference: 'Portfolio No.', product: 'Fund Code', feeType: 'Fee Name', description: 'Fee Arrangement Type',
      // "Date Paid" is the payment date, not the fee month — left unmapped.
    },
    // No GST column — UNCONFIRMED whether "Total" includes GST.
    amountBasis: 'incl_gst',
  },
  {
    id: 'australian-unity-lifeplan-csv',
    label: 'Australian Unity / Lifeplan investment bond commission (CSV)',
    provider: 'Australian Unity',
    providerType: 'investment_bond',
    headerRow: null,
    requiredHeaders: ['adviser id', 'policy id', 'transaction description', 'payment to bank', 'payment'],
    columns: {
      // "Payment" is the fee; "Transaction Amount" is $0.00 on fee rows.
      amount: 'Payment', adviserCode: 'Adviser ID', adviserName: 'Adviser Name', clientName: 'Client Name',
      reference: 'Policy ID', product: 'Product Description', feeType: 'Transaction Description',
      description: 'Option Description',
      // "Transaction Date" is years old (the bond's fee start), not the fee month.
    },
    // No GST column — UNCONFIRMED whether "Payment" includes GST.
    amountBasis: 'incl_gst',
  },
  {
    id: 'generation-life-asf-xlsx',
    label: 'Generation Life adviser service fee (Excel, no header row)',
    provider: 'Generation Life',
    providerType: 'investment_bond',
    headerRow: NO_HEADER_ROW,
    // A "Adviser: <name>", B bond number, C name, F fee type, J fee ex GST,
    // K GST, L total, M period start, O period end (from the matching PDF).
    matchesRows: (rows) => {
      const sample = firstDataRows(rows)
      return sample.length > 0 && sample.every((r) =>
        /^adviser:/i.test(cellText(r[0])) && /^\d+$/.test(cellText(r[1])) && isAmount(r[9]) && isAmount(r[10]) &&
        parseDateCell(r[12] ?? null) !== null)
    },
    columns: {
      adviserName: 'Column 1', reference: 'Column 2', clientName: 'Column 3', feeType: 'Column 6',
      amount: 'Column 10', gst: 'Column 11', period: 'Column 13',
    },
    amountBasis: 'ex_gst',
    // UNCONFIRMED: Generation Life's "Adviser Service Fee" is the ongoing fee.
    feeTypeValues: { 'adviser service fee': 'ongoing' },
  },
  {
    id: 'ezidebit-transactions-csv',
    label: 'Ezidebit transaction list (CSV, no header row)',
    provider: 'Ezidebit',
    providerType: 'direct_debit',
    headerRow: NO_HEADER_ROW,
    // 1 transaction date, 2 Ezidebit payer ID, 3 payer name, 4 payment amount,
    // 5 amount debited incl. the payer's fee, 6 fees charged to us, 7 payer fee
    // (columns 4/6 match the settlement PDF's "Payment Amt" / "Fees").
    matchesRows: (rows) => {
      const sample = firstDataRows(rows)
      return sample.length > 0 && sample.every((r) =>
        r.length === 7 && parseDateCell(r[0]) !== null && /^\d{3}-\d{3}-\d{3}$/.test(cellText(r[1])) &&
        isAmount(r[3]) && isAmount(r[4]))
    },
    columns: { reference: 'Column 2', clientName: 'Column 3', amount: 'Column 4' },
    // Client fees — UNCONFIRMED that they include GST, and which fee type they are.
    amountBasis: 'incl_gst',
  },
]

export interface RecognisedFormat {
  format: StatementFormat
  sheetName: string
  mapping: ImportMapping
}

function matches(format: StatementFormat, rows: Cell[][]): boolean {
  if (format.matchesRows) return format.matchesRows(rows)
  const hr = format.headerRow ?? detectHeaderRow(rows)
  if (hr === NO_HEADER_ROW) return false
  const hs = new Set(headersAt(rows, hr).map(norm))
  return (format.requiredHeaders ?? []).every((h) => hs.has(h))
}

/** The first known format any sheet matches, with a ready-to-use mapping. */
export function recogniseFormat(sheets: ParsedSheet[]): RecognisedFormat | null {
  for (const sheet of sheets) {
    for (const format of STATEMENT_FORMATS) {
      if (!matches(format, sheet.rows)) continue
      return {
        format,
        sheetName: sheet.name,
        mapping: {
          ...emptyMapping(),
          formatId: format.id,
          sheetName: sheet.name,
          headerRow: format.headerRow,
          columns: { ...format.columns },
          amountBasis: format.amountBasis,
          feeTypeValues: { ...(format.feeTypeValues ?? {}) },
          defaultFeeType: format.defaultFeeType ?? null,
        },
      }
    }
  }
  return null
}

/**
 * The mapping to start an upload from. The provider's saved mapping wins when
 * its columns still exist and it's for the same layout; else a recognised
 * format (keeping fee wording the provider has already taught us); else null
 * (the caller guesses from header text).
 */
export function startingMapping(sheets: ParsedSheet[], saved: ImportMapping | null): { mapping: ImportMapping; format: StatementFormat | null } | null {
  const known = recogniseFormat(sheets)
  if (saved) {
    const s = sheets.find((x) => x.name === saved.sheetName) ?? sheets[0]
    const hs = headersAt(s.rows, saved.headerRow ?? detectHeaderRow(s.rows))
    const cols = Object.values(saved.columns).filter(Boolean)
    const fits = cols.length > 0 && cols.every((h) => hs.includes(h!))
    const sameLayout = !known || saved.formatId === known.format.id
    if (fits && sameLayout) return { mapping: { ...saved, sheetName: s.name }, format: known?.format ?? null }
  }
  if (!known) return null
  const learnt = saved?.formatId === known.format.id ? saved : null
  return {
    format: known.format,
    mapping: {
      ...known.mapping,
      feeTypeValues: { ...known.mapping.feeTypeValues, ...(saved?.feeTypeValues ?? {}) },
      defaultFeeType: learnt?.defaultFeeType ?? known.mapping.defaultFeeType,
    },
  }
}
