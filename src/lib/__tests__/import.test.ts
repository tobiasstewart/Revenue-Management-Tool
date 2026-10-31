import { describe, it, expect } from 'vitest'
import { parseCsv } from '../import/csv'
import { normaliseExcelValue, parseDateCell } from '../import/cells'
import { applyMapping, detectHeaderRow, distinctFeeTexts, emptyMapping, guessColumns } from '../import/mapping'

describe('parseCsv', () => {
  it('handles quotes, commas and CRLF', () => {
    expect(parseCsv('﻿a,"b, c","d ""e"""\r\n1,2,3\n')).toEqual([
      ['a', 'b, c', 'd "e"'],
      ['1', '2', '3'],
    ])
  })
})

describe('normaliseExcelValue', () => {
  it('unwraps exceljs shapes', () => {
    expect(normaliseExcelValue(new Date(Date.UTC(2026, 7, 31)))).toBe('2026-08-31')
    expect(normaliseExcelValue({ formula: 'A1*2', result: 42 })).toBe(42)
    expect(normaliseExcelValue({ richText: [{ text: 'Hub' }, { text: '24' }] })).toBe('Hub24')
    expect(normaliseExcelValue({ text: 'link', hyperlink: 'x' })).toBe('link')
    expect(normaliseExcelValue({ error: '#N/A' })).toBeNull()
    expect(normaliseExcelValue('  ')).toBeNull()
  })
})

describe('parseDateCell', () => {
  it.each([
    ['31/08/2026', '2026-08-31'],
    ['1/9/26', '2026-09-01'],
    ['2026-08-31', '2026-08-31'],
    ['31-Aug-2026', '2026-08-31'],
    ['Aug 2026', '2026-08-01'],
    ['August 2026', '2026-08-01'],
    ['08/2026', '2026-08-01'],
    [46265, '2026-08-31'],
  ])('%s → %s', (v, iso) => {
    expect(parseDateCell(v)).toBe(iso)
  })
  it.each(['31/02/2026', 'hello', 12])('%s → null', (v) => {
    expect(parseDateCell(v)).toBeNull()
  })
})

// Shape of a typical platform commission statement: a title block, then a table.
const sheet = [
  ['Hub24 Adviser Remuneration Statement', null, null, null, null, null],
  ['Period: August 2026', null, null, null, null, null],
  [null, null, null, null, null, null],
  ['Account Number', 'Client Name', 'Product', 'Fee Type', 'Amount Incl GST', 'GST'],
  ['IA123456', 'SMITH, John', 'Hub24 Super', 'Ongoing Advice Fee', '$1,100.00', 100],
  ['IA654321', 'Citizen, Jane', 'Hub24 IDPS', 'Initial Advice Fee', 3300, 300],
  ['IA777777', 'Wong, Lee', 'Hub24 IDPS', 'Adviser Service Fee', '220.00', null],
  [null, null, null, null, null, null],
  ['Total', null, null, null, 4620, 400],
]

describe('statement mapping', () => {
  it('finds the header row under a title block', () => {
    expect(detectHeaderRow(sheet)).toBe(3)
  })

  it('guesses the columns from the headers', () => {
    expect(guessColumns(sheet[3] as string[])).toEqual({
      reference: 'Account Number',
      clientName: 'Client Name',
      product: 'Product',
      feeType: 'Fee Type',
      amount: 'Amount Incl GST',
      gst: 'GST',
    })
  })

  const mapping = {
    ...emptyMapping(),
    columns: guessColumns(sheet[3] as string[]),
    amountBasis: 'incl_gst' as const,
  }

  it('builds lines ex-GST, classifies fee types and skips the total row', () => {
    const r = applyMapping(sheet, mapping)
    expect(r.errors).toEqual([])
    expect(r.skipped).toBe(1)
    expect(r.lines.map((l) => [l.reference, l.amountCents, l.gstCents, l.feeType])).toEqual([
      ['IA123456', 100000, 10000, 'ongoing'],
      ['IA654321', 300000, 30000, 'upfront'],
      // no GST column value → 1/11 of the inclusive amount
      ['IA777777', 20000, 2000, null],
    ])
    expect(r.lines[0].rowNumber).toBe(5)
  })

  it('a learnt fee-type value and a default apply', () => {
    const r = applyMapping(sheet, { ...mapping, feeTypeValues: { 'adviser service fee': 'ongoing' } })
    expect(r.lines[2].feeType).toBe('ongoing')
    const d = applyMapping(sheet, { ...mapping, columns: { ...mapping.columns, feeType: undefined }, defaultFeeType: 'ongoing' })
    expect(d.lines.every((l) => l.feeType === 'ongoing')).toBe(true)
  })

  it('reports rows whose amount is not a number', () => {
    const bad = [...sheet.slice(0, 4), ['X1', 'A B', '', 'Renewal', 'abc', null]]
    expect(applyMapping(bad, mapping).errors).toEqual([{ rowNumber: 5, message: 'Amount "abc" isn\'t a number' }])
  })

  it('needs an amount column', () => {
    const r = applyMapping(sheet, { ...mapping, columns: {} })
    expect(r.lines).toEqual([])
    expect(r.errors[0].message).toMatch(/amount/)
  })

  it('takes each line\'s month from a period column when mapped', () => {
    const withPeriod = [
      ['Policy No', 'Life Insured', 'Commission Type', 'Commission', 'Period'],
      ['P1', 'Jane Citizen', 'Renewal', 50, 'Jul 2026'],
      ['P2', 'Jane Citizen', 'Renewal', 50, '31/08/2026'],
    ]
    const r = applyMapping(withPeriod, { ...emptyMapping(), columns: guessColumns(withPeriod[0] as string[]) })
    expect(r.lines.map((l) => l.generationMonth)).toEqual(['2026-07', '2026-08'])
  })

  it('lists distinct fee texts for the value table', () => {
    expect(distinctFeeTexts(sheet, mapping)).toEqual(['Ongoing Advice Fee', 'Initial Advice Fee', 'Adviser Service Fee'])
  })
})
