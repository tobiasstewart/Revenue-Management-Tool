import { describe, it, expect } from 'vitest'
import { adviserShareCents, shareholderDistribution, totals, upfrontsOwed, type ReportLine } from '../reports'

const base: ReportLine = {
  amount_cents: 0,
  gst_cents: 0,
  fee_type: null,
  adviser_id: null,
  adviser_split_pct: null,
  household_id: 'h1',
  provider_id: 'p1',
  received_date: '2026-09-15',
  generation_month: '2026-08-01',
}
const line = (o: Partial<ReportLine>): ReportLine => ({ ...base, ...o })

const lines: ReportLine[] = [
  line({ amount_cents: 300000, gst_cents: 30000, fee_type: 'upfront', adviser_id: 'alice', adviser_split_pct: 60 }),
  line({ amount_cents: 100000, fee_type: 'ongoing', adviser_id: 'alice', adviser_split_pct: 0 }),
  line({ amount_cents: 50000, fee_type: 'one_off', adviser_id: 'bob', adviser_split_pct: 60 }),
  line({ amount_cents: 20000, fee_type: 'upfront', adviser_id: null, household_id: null }),
  line({ amount_cents: 7000, fee_type: null, adviser_id: 'bob' }),
]

describe('adviser split', () => {
  it('advisers keep 60% of upfront and one-off, none of ongoing', () => {
    expect(lines.map(adviserShareCents)).toEqual([180000, 0, 30000, 0, 0])
  })
})

describe('totals', () => {
  it('splits by fee type and between adviser and business', () => {
    expect(totals(lines)).toEqual({
      count: 5,
      amount: 477000,
      gst: 30000,
      upfront: 320000,
      ongoing: 100000,
      oneOff: 50000,
      unclassified: 7000,
      adviserShare: 210000,
      // 120,000 + 100,000 + 20,000 + 20,000 (unallocated upfront stays with the business until matched)
      businessShare: 260000,
      unmatchedCount: 1,
      unmatchedAmount: 20000,
    })
  })
})

describe('upfrontsOwed', () => {
  it('reports each adviser and flags what is not yet allocated', () => {
    const r = upfrontsOwed(lines)
    expect(r.rows).toEqual([
      { adviserId: 'alice', upfront: 300000, oneOff: 0, adviserShare: 180000, businessShare: 120000, lineCount: 1 },
      { adviserId: 'bob', upfront: 0, oneOff: 50000, adviserShare: 30000, businessShare: 20000, lineCount: 1 },
    ])
    expect(r.unallocated).toEqual({ amount: 20000, count: 1 })
    expect(r.unclassified).toEqual({ amount: 7000, count: 1 })
  })
})

describe('shareholderDistribution', () => {
  const holders = [
    { id: 's1', name: 'Toby', share_pct: 50, effective_from: '2000-01-01', effective_to: '2026-08-31' },
    { id: 's2', name: 'Sam', share_pct: 50, effective_from: '2000-01-01', effective_to: null },
    { id: 's3', name: 'Toby (new)', share_pct: 50, effective_from: '2026-09-01', effective_to: null },
  ]
  const two = [
    line({ amount_cents: 100000, fee_type: 'ongoing', received_date: '2026-08-10', generation_month: '2026-07-01' }),
    line({ amount_cents: 200000, fee_type: 'ongoing', received_date: '2026-09-10', generation_month: '2026-08-01' }),
  ]

  it('uses the holdings in effect at each month end', () => {
    const r = shareholderDistribution(two, holders, 'received')
    expect(r.pool).toBe(300000)
    expect(r.rows).toEqual([
      { shareholderId: 's2', name: 'Sam', amount: 150000 },
      { shareholderId: 's3', name: 'Toby (new)', amount: 100000 },
      { shareholderId: 's1', name: 'Toby', amount: 50000 },
    ])
    expect(r.monthsNot100).toEqual([])
  })

  it('months follow the basis', () => {
    // On the generated basis both lines fall in Jul/Aug, when s1 still held.
    const r = shareholderDistribution(two, holders, 'generated')
    expect(r.rows.find((x) => x.shareholderId === 's1')?.amount).toBe(150000)
    expect(r.rows.find((x) => x.shareholderId === 's3')).toBeUndefined()
  })

  it('flags months whose holdings do not total 100%', () => {
    const r = shareholderDistribution(two, holders.slice(1, 2), 'received')
    expect(r.monthsNot100).toEqual(['2026-08', '2026-09'])
  })

  it('excludes the adviser share and unclassified lines from the pool', () => {
    const r = shareholderDistribution(lines, holders.slice(1), 'received')
    expect(r.pool).toBe(260000)
  })
})
