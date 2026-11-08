import { describe, it, expect } from 'vitest'
import {
  buildSnapshot, closeBlockers, closeWarnings, defaultCloseMonth, hasBlockers, reconcile, snapshotDrift, statementChecklist,
  type CloseProvider, type CloseStatement,
} from '../month-close'
import type { ReportLine, ShareholderRow } from '../reports'

const provider = (id: string, statement_frequency: CloseProvider['statement_frequency'], is_active = true): CloseProvider =>
  ({ id, name: id.toUpperCase(), is_active, statement_frequency })

const stmt = (id: string, provider_id: string, received_date: string, amount: number, gst: number, deposit: number | null): CloseStatement =>
  ({ id, provider_id, received_date, deposit_amount_cents: deposit, status: 'draft', line_count: 1, amount_cents: amount, gst_cents: gst })

const line = (p: Partial<ReportLine>): ReportLine => ({
  amount_cents: 10000, gst_cents: 1000, fee_type: 'ongoing', adviser_id: null, adviser_split_pct: 0,
  household_id: 'h1', provider_id: 'p', received_date: '2026-09-15', generation_month: '2026-09-01', ...p,
})

const holders: ShareholderRow[] = [
  { id: 's1', name: 'Shareholder One', share_pct: 50, effective_from: '2000-01-01', effective_to: null },
  { id: 's2', name: 'Shareholder Two', share_pct: 50, effective_from: '2000-01-01', effective_to: null },
]

describe('reconcile', () => {
  it('allows a couple of cents of provider rounding', () => {
    expect(reconcile(10000, 10002)).toEqual({ status: 'ok', diff: 2 })
    expect(reconcile(10000, 9990)).toEqual({ status: 'differs', diff: -10 })
    expect(reconcile(10000, null)).toEqual({ status: 'no_deposit', diff: null })
  })
})

describe('statementChecklist', () => {
  const providers = [
    provider('clearview', 'weekly'), provider('tal', 'monthly'), provider('acenda', 'fortnightly'),
    provider('bond', 'quarterly'), provider('direct', 'irregular'), provider('old', 'monthly', false),
  ]
  const inMonth = [
    stmt('c1', 'clearview', '2026-09-09', 100, 10, 110), stmt('c2', 'clearview', '2026-09-16', 100, 10, 110),
    stmt('c3', 'clearview', '2026-09-23', 100, 10, 110), stmt('c4', 'clearview', '2026-09-30', 100, 10, 120),
    stmt('a1', 'acenda', '2026-09-17', 100, 10, null),
  ]
  const recent = [stmt('b0', 'bond', '2026-07-10', 100, 0, 100), stmt('t0', 'tal', '2026-08-01', 1, 0, 1)]
  const rows = statementChecklist('2026-09', providers, inMonth, recent)
  const byId = Object.fromEntries(rows.map((r) => [r.provider.id, r]))

  it('flags missing and short providers first, and leaves out inactive ones with nothing', () => {
    expect(rows.map((r) => [r.provider.id, r.status])).toEqual([
      ['tal', 'missing'], ['acenda', 'short'], ['bond', 'ok'], ['clearview', 'ok'], ['direct', 'not_expected'],
    ])
  })
  it('reconciles each statement and totals the month', () => {
    expect(byId.clearview.statements.map((s) => s.reconciliation)).toEqual(['ok', 'ok', 'ok', 'differs'])
    expect(byId.clearview.inclCents).toBe(440)
    expect(byId.acenda.statements[0].reconciliation).toBe('no_deposit')
  })
  it('remembers when a provider last sent anything', () => {
    expect(byId.tal.lastReceived).toBe('2026-08-01')
    expect(byId.clearview.lastReceived).toBe('2026-09-30')
  })
  it('treats a quarterly provider as overdue after three months of nothing', () => {
    const r = statementChecklist('2026-10', [provider('bond', 'quarterly')], [], recent)
    expect(r[0].status).toBe('overdue')
  })
})

describe('closeBlockers', () => {
  it('blocks on unclassified lines and upfronts with nobody to pay, not on ongoing without an adviser', () => {
    const b = closeBlockers([
      line({ fee_type: null, amount_cents: 500 }),
      line({ fee_type: 'upfront', adviser_id: null, amount_cents: 700 }),
      line({ fee_type: 'one_off', adviser_id: 'a1', adviser_split_pct: 60 }),
      line({ fee_type: 'ongoing', adviser_id: null }),
    ])
    expect(b).toEqual({ unclassified: { count: 1, amount: 500 }, upfrontNoAdviser: { count: 1, amount: 700 } })
    expect(hasBlockers(b)).toBe(true)
    expect(hasBlockers(closeBlockers([line({})]))).toBe(false)
  })
})

describe('closeWarnings', () => {
  const okRows = statementChecklist('2026-09', [provider('tal', 'monthly')], [stmt('t', 'tal', '2026-09-01', 10000, 1000, 11000)], [])

  it('is quiet for a clean month', () => {
    expect(closeWarnings([line({})], okRows, holders, '2026-09')).toEqual([])
  })
  it('warns about missing statements, deposits, unmatched lines and shareholdings', () => {
    const rows = statementChecklist('2026-09', [provider('tal', 'monthly'), provider('cv', 'weekly')],
      [stmt('t', 'tal', '2026-09-01', 10000, 1000, null), stmt('c', 'cv', '2026-09-02', 100, 10, 999)], [])
    const w = closeWarnings([line({ household_id: null })], rows, [{ ...holders[0], share_pct: 60 }], '2026-09')
    expect(w.map((x) => x.key)).toEqual(['statements', 'reconciliation', 'unmatched', 'shareholders'])
    expect(w[0].message).toContain('CV (1 of 4)')
    expect(w[1].message).toBe("1 statement doesn't match the bank deposit; 1 has no deposit recorded.")
  })
  it('warns when nobody holds shares at month end', () => {
    const w = closeWarnings([line({})], okRows, [{ ...holders[0], effective_to: '2026-08-31' }], '2026-09')
    expect(w.map((x) => x.message)).toEqual(['No shareholders are set up for this month — the business share has no one to go to.'])
  })
})

describe('buildSnapshot / snapshotDrift', () => {
  const lines = [
    line({ fee_type: 'upfront', adviser_id: 'a1', adviser_split_pct: 60, amount_cents: 100000 }),
    line({ fee_type: 'ongoing', amount_cents: 50000 }),
  ]
  const checklist = statementChecklist('2026-09', [provider('tal', 'monthly')], [stmt('t', 'tal', '2026-09-05', 150000, 15000, 165000)], [])
  const snap = buildSnapshot({ month: '2026-09', lines, checklist, shareholders: holders, adviserNames: new Map([['a1', 'Alex Adviser']]), acknowledged: [] })

  it('freezes adviser and shareholder payouts', () => {
    expect(snap.advisers).toEqual([{ adviserId: 'a1', name: 'Alex Adviser', upfront: 100000, oneOff: 0, adviserShare: 60000, lineCount: 1 }])
    // business = 40% of the upfront + all the ongoing = 90,000c, split 50/50
    expect(snap.shareholderPool).toBe(90000)
    expect(snap.shareholders.map((s) => [s.name, s.sharePct, s.amount])).toEqual([['Shareholder One', 50, 45000], ['Shareholder Two', 50, 45000]])
    expect(snap.statements).toEqual([{ id: 't', provider: 'TAL', receivedDate: '2026-09-05', inclCents: 165000, depositCents: 165000 }])
  })
  it('reports drift when shareholdings change after closing', () => {
    expect(snapshotDrift(snap, snap)).toEqual([])
    const later = buildSnapshot({
      month: '2026-09', lines, checklist, adviserNames: new Map(), acknowledged: [],
      shareholders: [{ ...holders[0], share_pct: 70 }, { ...holders[1], share_pct: 30 }],
    })
    expect(snapshotDrift(snap, later)).toEqual(['Shareholder split'])
  })
})

describe('defaultCloseMonth', () => {
  it('is last month', () => expect(defaultCloseMonth('2026-11-08')).toBe('2026-10'))
})
