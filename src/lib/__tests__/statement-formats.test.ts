import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import type { Cell, ParsedSheet } from '../import/cells'
import { applyMapping, detectHeaderRow, NO_HEADER_ROW } from '../import/mapping'
import { recogniseFormat, startingMapping } from '../import/formats'
import { parseCsvSheet, parseXlsx } from '../import/workbook'
import { classifyFeeType } from '../fee-type'

// One test per provider layout seen in Toby's statements. Real headers and
// quirks (preambles, footers, codes, zero-padding); the people, policies and
// amounts are INVENTED. Never paste real statement rows in here.

function read(sheet: ParsedSheet) {
  const rec = recogniseFormat([sheet])
  if (!rec) throw new Error('format not recognised')
  const r = applyMapping(sheet.rows, rec.mapping)
  return {
    id: rec.format.id,
    r,
    lines: r.lines.map((l) => ({
      client: l.clientName, ref: l.reference, code: l.adviserCode, adviser: l.adviserName,
      type: l.feeType, ex: l.amountCents, gst: l.gstCents, month: l.generationMonth,
    })),
  }
}

describe('ClearView commission statement CSV', () => {
  const H = 'Adviser_Dealer_Code1,Adviser_Sales_Code1,Adviser_name,Comm_Payment_Period_Code,Comm_Payment_Period_Date_Start,Comm_Payment_Period_Date_End,Comm_Payment_Date,Policy_No,Policy_Risk_Start_Date,Benefit_Risk_Start_Date,Policy_Renewal_Period,Policy_Payment_Period,Life_Insured_Name,Product,Benefit_Type,Benefit,Trans_Type,Adviser_Count1,Adviser_Comm_Perc,Comm_Payment_Basis,Comm_Type,Comm_Syndicate,Comm_Dial_Down_Perc,Comm_Perc_Initial,Comm_Perc_Renewal,Comm_Payable_Amt_Net1,Comm_Payable_Amt_GST,Comm_Payable_Amt1,Date_Last_Updated'
  const csv = [
    H,
    'HPPL,XP000001,Alex Adviser,FY2027-P03-Sep-05,23/09/2026,29/09/2026,30/09/2026,550000001,21/05/2024,21/05/2024,Year 3,5 of 12,Jane Citizen,ClearChoice - Ordinary,Trauma,Standalone Trauma,Renewal,1,100,133.81,Upfront,UF66T22D000,0.0,66,22,26.7600,2.6800,29.44,30/09/2026',
    'HPPL,XP000002,Sam Planner,FY2027-P03-Sep-05,23/09/2026,29/09/2026,30/09/2026,550000002,22/09/2026,22/09/2026,Year 1,1 of 1,John Smith,ClearChoice - Life Under Super,Income Protection,Income Protection Flex,New Business,1,100,2054.69,Upfront,UF66T22D000,0.0,66,22,1232.8200,123.2800,"1,356.10",30/09/2026',
    '',
  ].join('\r\n')
  const { id, lines } = read(parseCsvSheet(csv))

  it('is recognised', () => expect(id).toBe('clearview-commstmt-csv'))
  it('takes the fee type from Trans_Type — Comm_Type says "Upfront" on renewals too', () => {
    expect(lines).toEqual([
      { client: 'Jane Citizen', ref: '550000001', code: 'XP000001', adviser: 'Alex Adviser', type: 'ongoing', ex: 2676, gst: 268, month: '2026-09' },
      { client: 'John Smith', ref: '550000002', code: 'XP000002', adviser: 'Sam Planner', type: 'upfront', ex: 123282, gst: 12328, month: '2026-09' },
    ])
  })
})

describe('TAL commission statement CSV (with Asteron policies)', () => {
  const csv = [
    'Commission Statement for Period 01/10/2026',
    'ALEX ADVISER 10001',
    '"',
    '"',
    'Commission Details',
    'Policy Number,Entity Name,Life Insured Name,Product Name,Product Code,Commission Type,Commission Premium,Commission Rate %,Total Commission,Adviser sub ID,"Adviser sub ID Name "',
    '7000001,TAL,JANE CITIZEN,Life Insurance Plan - Hybrid,RDTH57.11,RENEW,75.33,22.0000000,16.57,10001,Alex Adviser',
    '7000001,TAL,JANE CITIZEN,Life Insurance Plan - Hybrid,RDTH57.11,RENEW,12.46,0.00000000,0.00,10001,Alex Adviser',
    'S2000001,Asteron,John Smith,Sun Yearly Renewable Term Ord,ST41,RC,212.31,10.0000000,22.04,J0001,Alex Adviser',
  ].join('\n')
  const sheet = parseCsvSheet(csv)
  const { id, r, lines } = read(sheet)

  it('is recognised past the preamble', () => {
    expect(id).toBe('tal-commstmt-csv')
    // The two lone '"' lines are one quoted (multi-line) field, so the
    // header is CSV row 5 (index 4), as in TAL's real file.
    expect(detectHeaderRow(sheet.rows)).toBe(4)
  })
  it('reads RENEW / RC as renewal, skips $0.00 rows, keeps both adviser codes', () => {
    expect(r.skipped).toBe(1)
    expect(lines).toEqual([
      { client: 'JANE CITIZEN', ref: '7000001', code: '10001', adviser: 'Alex Adviser', type: 'ongoing', ex: 1657, gst: 0, month: null },
      { client: 'John Smith', ref: 'S2000001', code: 'J0001', adviser: 'Alex Adviser', type: 'ongoing', ex: 2204, gst: 0, month: null },
    ])
  })
})

describe('CFS / Avanteos adviser service fee CSV', () => {
  const H = 'Record,Product Name,Fund Val date,Transaction Gross Amount,Adviser Code,Adviser name,Account mailing name,Address-1,Address-2,Address-3,Suburb,Postcode,Country,Units,Unit balance,Payment amount inc GST,Payment type,Funds Under Management per Option,Account Number,Product Number,Option Number,Payment GST Amount,Withheld Tax Amount,Adjustment Transaction Date,APIR Code,Previous Dealer Code,Previous Adviser Code,'
  const csv = [
    '00001EXAMPLE PLANNING PTY LTD               20260916    Transaction Statement     20261006Avanteos Investments Limited',
    H,
    '1,FirstChoice WS Super,00000000,000000099.50,0101,ALEX ADVISER,MRS JANE CITIZEN,1 EXAMPLE ST,,,SUBURB,4000,,000000099.5000,,000000099.50,A,375.71,001010000000001,0011,0049,0000009.05,000000000.00,00000000,FSF0000AU,,,',
    '1,FirstChoice WS Super,20260930,000000027.72,0102,Sam Planner,MR JOHN SMITH,2 EXAMPLE ST,,,SUBURB,4000,,000000023.5200,,000000000.00,C,,001010000000002,0011,0800,0000000.00,000000000.00,00000000,FSF0001AU,,,',
    '9,Trailer,000000000.00,000000002,000000000.00,000000000,00000099.50,000000001,000000000.00,000000000,000000000.00,000000000,000000000.00,000000000,,,......',
  ].join('\r\n')
  const sheet = parseCsvSheet(csv)
  const { id, r, lines } = read(sheet)

  it('is recognised under the fixed-width record-0 line', () => {
    expect(id).toBe('cfs-asf-csv')
    expect(detectHeaderRow(sheet.rows)).toBe(1)
  })
  it('splits the GST-inclusive payment, reads A as the ongoing service fee, skips $0 commission and the trailer', () => {
    expect(r.skipped).toBe(2)
    expect(lines).toEqual([
      { client: 'MRS JANE CITIZEN', ref: '001010000000001', code: '0101', adviser: 'ALEX ADVISER', type: 'ongoing', ex: 9045, gst: 905, month: null },
    ])
  })
})

describe('Australian Unity adviser service fee by portfolio (Excel)', () => {
  const rows: Cell[][] = [
    ['Adviser Service Fee by Portfolio', null, null, null, null, null, null, null, null, null],
    ['Period: 01/09/2026 - 30/09/2026', null, null, null, null, null, null, null, null, null],
    ['Agent: Example Planning Pty Ltd', null, null, null, null, null, null, null, null, null],
    ['Agent Code: I000001', null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null],
    ['Adviser Code', 'Adviser Name', 'Primary Owner', 'Portfolio No.', 'Fund Code', 'Fee Name', 'Fee Arrangement Type', 'Date Paid', 'Total', null],
    ['I000002', 'Alex Adviser', 'JANE CITIZEN', '30000001', 'S1MMG', 'Adviser Ongoing Service Fee', 'Ongoing Fee Advice', '2026-10-05', 110, null],
    ['Total for Example Planning Pty Ltd', null, null, null, null, null, null, null, 110, null],
  ]
  const { id, r, lines } = read({ name: 'Sheet1', rows })

  it('is recognised; "Date Paid" is not used as the fee month', () => {
    expect(id).toBe('australian-unity-asf-xlsx')
    expect(r.skipped).toBe(1)
    expect(lines).toEqual([
      { client: 'JANE CITIZEN', ref: '30000001', code: 'I000002', adviser: 'Alex Adviser', type: 'ongoing', ex: 10000, gst: 1000, month: null },
    ])
  })
})

describe('Australian Unity / Lifeplan investment bond CSV', () => {
  const csv = [
    '"Commission Start Date","Commission End Date","Company Name","Dealer Code"',
    '"01/09/2026","30/09/2026","Lifeplan Australia Friendly Society","90001"',
    '',
    '"Adviser ID","Adviser Name","Client Name","Policy ID","Product Description","Option Description","Transaction Date","Transaction Amount","Transaction Description","Payment to Bank","Payment"',
    '"100001","Alex Adviser","CITIZEN Jane","5400001","Lifeplan Investment Bond","Vanguard High Growth Index Fund","02/12/2024","$0.00","ONGO ADVISER FEE","$22.00","$22.00"',
    '"","","","","","","","","Total Payment to Bank","$22.00",""',
  ].join('\n')
  const sheet = parseCsvSheet(csv)
  const { id, r, lines } = read(sheet)

  it('is recognised past the period block', () => {
    expect(id).toBe('australian-unity-lifeplan-csv')
    expect(detectHeaderRow(sheet.rows)).toBe(3)
  })
  it('takes "Payment" (not the $0.00 Transaction Amount or the old Transaction Date) and skips the bank total', () => {
    expect(r.skipped).toBe(1)
    expect(lines).toEqual([
      { client: 'CITIZEN Jane', ref: '5400001', code: '100001', adviser: 'Alex Adviser', type: 'ongoing', ex: 2000, gst: 200, month: null },
    ])
  })
})

describe('Generation Life adviser service fee (Excel, no header row)', () => {
  const row = (adviser: string, bond: string, name: string, ex: number, gst: number): Cell[] =>
    [`Adviser: ${adviser}`, bond, name, null, null, 'Adviser Service Fee', null, null, null, ex, gst, +(ex + gst).toFixed(2), '2026-09-01', null, '2026-09-30']
  const rows = [
    row('Alex Adviser', '20000001', 'Mr John Smith & Mrs Jane Smith', 17.41, 1.74),
    row('Sam Planner', '20000002', 'Example Pty Ltd ATF <Example Trust>', 244.33, 24.43),
  ]
  const sheet = { name: 'Sheet1', rows }
  const { id, lines } = read(sheet)

  it('is recognised although the first row is data', () => {
    expect(detectHeaderRow(rows)).toBe(NO_HEADER_ROW)
    expect(id).toBe('generation-life-asf-xlsx')
  })
  it('reads every row, strips the "Adviser:" label, takes the month from the fee period', () => {
    expect(lines).toEqual([
      { client: 'Mr John Smith & Mrs Jane Smith', ref: '20000001', code: '', adviser: 'Alex Adviser', type: 'ongoing', ex: 1741, gst: 174, month: '2026-09' },
      { client: 'Example Pty Ltd ATF <Example Trust>', ref: '20000002', code: '', adviser: 'Sam Planner', type: 'ongoing', ex: 24433, gst: 2443, month: '2026-09' },
    ])
  })
})

describe('Ezidebit transaction list CSV (no header row)', () => {
  const csv = [
    '01/10/2026,200-000-001,CITIZEN JANE & JOHN,330.00,332.38,0.00,2.38',
    '01/10/2026,200-000-002,EXAMPLE PTY LTD ATF EXAMPLE SUPER FUND,110.00,112.38,0.00,2.38',
  ].join('\n')
  const sheet = parseCsvSheet(csv)
  const { id, lines } = read(sheet)

  it('is recognised; the payment amount (not the payer-fee total) is GST-inclusive; fee type left for review', () => {
    expect(id).toBe('ezidebit-transactions-csv')
    expect(lines).toEqual([
      { client: 'CITIZEN JANE & JOHN', ref: '200-000-001', code: '', adviser: '', type: null, ex: 30000, gst: 3000, month: null },
      { client: 'EXAMPLE PTY LTD ATF EXAMPLE SUPER FUND', ref: '200-000-002', code: '', adviser: '', type: null, ex: 10000, gst: 1000, month: null },
    ])
  })
})

describe('startingMapping', () => {
  const sheet = parseCsvSheet('01/10/2026,200-000-001,CITIZEN JANE,330.00,332.38,0.00,2.38\n')

  it('keeps fee wording and a default fee type the provider has taught us for the same layout', () => {
    const first = startingMapping([sheet], null)!.mapping
    const saved = { ...first, defaultFeeType: 'ongoing' as const, feeTypeValues: { x: 'upfront' as const } }
    const next = startingMapping([sheet], saved)!
    expect(next.format?.id).toBe('ezidebit-transactions-csv')
    expect(next.mapping.defaultFeeType).toBe('ongoing')
    expect(next.mapping.feeTypeValues).toEqual({ x: 'upfront' })
  })
  it("ignores a saved mapping from another layout (a provider with two statement formats)", () => {
    const saved = { ...startingMapping([sheet], null)!.mapping, formatId: 'some-other-format' }
    expect(startingMapping([sheet], saved)!.mapping.formatId).toBe('ezidebit-transactions-csv')
  })
  it('returns null for an unknown layout with nothing saved', () => {
    expect(startingMapping([parseCsvSheet('Foo,Bar,Baz\n1,2,3\n')], null)).toBeNull()
  })
})

describe('fee wording abbreviations', () => {
  it.each([['RENEW', 'ongoing'], ['ONGO ADVISER FEE', 'ongoing'], ['New Business', 'upfront']])('%s → %s', (t, want) => {
    expect(classifyFeeType(t)).toBe(want)
  })
})

describe('parseXlsx with a non-standard workbook', () => {
  // Same structure as Australian Unity's / Generation Life's report exports:
  // the sheet stored as xl/worksheets/Sheet1.xml (capital S — exceljs ignores
  // it and reports NO sheets) and cells out to column O after gaps (exceljs's
  // column count stopped at I and dropped the amounts).
  async function workbook(): Promise<ArrayBuffer> {
    const zip = new JSZip()
    zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/Sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>')
    zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
    zip.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId3"/></sheets></workbook>')
    zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/Sheet1.xml"/><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>')
    zip.file('xl/sharedStrings.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="4" uniqueCount="4"><si><t>Adviser: Alex Adviser</t></si><si><t>20000001</t></si><si><t>Mr John Smith</t></si><si><t>Adviser Service Fee</t></si></sst>')
    zip.file('xl/worksheets/Sheet1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:O1"/><cols><col min="1" max="16384" width="10.00" customWidth="1"/></cols><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="F1" t="s"><v>3</v></c><c r="I1"/><c r="J1"><v>17.41</v></c><c r="K1"><v>1.74</v></c><c r="L1"><v>19.15</v></c><c r="M1"><v>46266</v></c><c r="O1"><v>46295</v></c></row></sheetData></worksheet>')
    return zip.generateAsync({ type: 'arraybuffer' })
  }

  it('reads the sheet and every column', async () => {
    const sheets = await parseXlsx(await workbook())
    expect(sheets.map((s) => s.name)).toEqual(['Sheet1'])
    const row = sheets[0].rows[0]
    expect(row.length).toBe(15)
    expect(row.slice(0, 3)).toEqual(['Adviser: Alex Adviser', '20000001', 'Mr John Smith'])
    expect(row.slice(9, 12)).toEqual([17.41, 1.74, 19.15])
  })
})
