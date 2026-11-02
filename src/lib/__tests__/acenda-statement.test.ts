import { describe, it, expect } from 'vitest'
import { parseCsv } from '../import/csv'
import type { Cell } from '../import/cells'
import { applyMapping, detectHeaderRow, distinctFeeTexts, emptyMapping, guessColumns, headersAt } from '../import/mapping'
import { adviserKey, buildAdviserMatcher, statementAdvisers } from '../matching'

// Same columns and quirks as Acenda's commission statement CSV (trailing
// spaces in names, 4dp totals, a "Balance brought forward" footer); the
// people and policies are made up.
const CSV = `Company name,Adviser number,Adviser name,Statement date,Policy number,Client last name,Client first name,Premium amount,Premium frequency,Commission type,Commission group,Product type,Commission paid excluding GST,GST,Total including GST,Benefit,Product Name,Benefit Start Date,Remuneration Structure,Initial Clawback Commission,Renewal Clawback Commission,Policy Commencement Date,Scheme Commencement Date,Commission Percentage
Nippon Life Insurance Australia and New Zealand Limited,SB1111111,ALEX ADVISER,29/10/2026,93000001,Citizen ,Jane ,1437.24,Monthly,Premium Based Renewal Commission,Commission,Acenda Insurance,287.44,28.74,316.1800,Income Protection Platinum,Acenda Insurance,2019-09-09,Hybrid LIF,,,2019-09-09,,20
Nippon Life Insurance Australia and New Zealand Limited,SB2222222,Sam Planner,29/10/2026,R2100001,Smith ,John ,145.51,Monthly,Initial Commission,Commission,Acenda Insurance,1200.00,120.00,1320.0000,Life Cover,Acenda Insurance,2026-10-01,Upfront GF,,,2026-10-01,,66
Nippon Life Insurance Australia and New Zealand Limited,SB2222222,Sam Planner,29/10/2026,R2100002,Wong ,Lee ,40.00,Yearly,Initial Clawback Commission,Commission,Acenda Insurance,-300.00,-30.00,-330.0000,Life Cover,Acenda Insurance,2026-03-01,Upfront GF,-300.00,,2026-03-01,,66
,,,,,,,,,Balance brought forward from previous period,,,,,0.00
`

const rows: Cell[][] = parseCsv(CSV).map((r) => r.map((c) => c.trim() || null))

describe('Acenda commission statement', () => {
  const hr = detectHeaderRow(rows)
  const columns = guessColumns(headersAt(rows, hr))

  it('guesses every column correctly', () => {
    expect(hr).toBe(0)
    expect(columns).toEqual({
      gst: 'GST',
      amount: 'Commission paid excluding GST',
      adviserCode: 'Adviser number',
      adviserName: 'Adviser name',
      reference: 'Policy number',
      clientFirstName: 'Client first name',
      clientLastName: 'Client last name',
      feeType: 'Commission type',
      product: 'Benefit',
      period: 'Statement date',
    })
  })

  const mapping = { ...emptyMapping(), columns }
  const r = applyMapping(rows, mapping)

  it('reads the lines, skipping the balance footer', () => {
    expect(r.errors).toEqual([])
    expect(r.skipped).toBe(1)
    expect(r.lines.map((l) => [l.clientName, l.reference, l.adviserCode, l.adviserName, l.feeType, l.amountCents, l.gstCents, l.generationMonth])).toEqual([
      ['Jane Citizen', '93000001', 'SB1111111', 'ALEX ADVISER', 'ongoing', 28744, 2874, '2026-10'],
      ['John Smith', 'R2100001', 'SB2222222', 'Sam Planner', 'upfront', 120000, 12000, '2026-10'],
      // a clawback is negative upfront — it reduces the adviser's share
      ['Lee Wong', 'R2100002', 'SB2222222', 'Sam Planner', 'upfront', -30000, -3000, '2026-10'],
    ])
  })

  it('lists fee wording only from rows with an amount', () => {
    expect(distinctFeeTexts(rows, mapping)).toEqual([
      'Premium Based Renewal Commission', 'Initial Commission', 'Initial Clawback Commission',
    ])
  })

  it('groups the statement by adviser', () => {
    expect(statementAdvisers(r.lines)).toEqual([
      { key: 'code:SB1111111', code: 'SB1111111', name: 'ALEX ADVISER', lines: 1, amountCents: 28744 },
      { key: 'code:SB2222222', code: 'SB2222222', name: 'Sam Planner', lines: 2, amountCents: 90000 },
    ])
  })
})

describe('buildAdviserMatcher', () => {
  const advisers = [
    { id: 'alex', name: 'Alex Adviser', is_active: true },
    { id: 'sam', name: 'Samantha Planner', is_active: true },
  ]
  const refs = [{ adviser_id: 'sam', provider_id: 'acenda', kind: 'code' as const, reference: 'SB2222222' }]
  const match = buildAdviserMatcher(refs, advisers)

  it('matches a learnt adviser code for the provider', () => {
    expect(match('acenda', 'sb2222222', 'whoever')).toEqual({ adviserId: 'sam', method: 'code' })
    expect(match('tal', 'SB2222222', '')).toEqual({ adviserId: null, method: null })
  })
  it('falls back to an exact adviser name in any case/order', () => {
    expect(match('acenda', 'SB9', 'ADVISER, ALEX')).toEqual({ adviserId: 'alex', method: 'adviser_name' })
  })
  it('does not guess a loose name', () => {
    expect(match('acenda', '', 'Sam Planner')).toEqual({ adviserId: null, method: null })
  })
  it('keys statement advisers by code, else name', () => {
    expect(adviserKey(' sb-1 ', 'x')).toBe('code:SB1')
    expect(adviserKey('', 'Planner, Sam')).toBe('name:planner sam')
  })
})
