import { describe, it, expect } from 'vitest'
import {
  addMonths, fyLabel, fyOf, generationMonthFor, inPeriod, lastOfMonth, lineMonth, monthsBetween,
  periodForFy, periodForMonth, periodLabel, todayIso,
} from '../periods'

describe('month arithmetic', () => {
  it('crosses year boundaries', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12')
    expect(addMonths('2026-12-15', 1)).toBe('2027-01')
    expect(addMonths('2026-03', -14)).toBe('2025-01')
  })
  it('knows month lengths', () => {
    expect(lastOfMonth('2028-02')).toBe('2028-02-29')
    expect(lastOfMonth('2026-09-10')).toBe('2026-09-30')
  })
  it('lists months inclusively', () => {
    expect(monthsBetween('2026-11-05', '2027-02-01')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02'])
  })
})

describe('financial years', () => {
  it('names an FY by the year it ends', () => {
    expect(fyOf('2026-06-30')).toBe(2026)
    expect(fyOf('2026-07-01')).toBe(2027)
    expect(fyLabel(2027)).toBe('FY2026–27')
    expect(periodForFy(2027)).toEqual({ from: '2026-07-01', to: '2027-06-30' })
  })
})

describe('periodLabel', () => {
  it('recognises months and FYs', () => {
    expect(periodLabel(periodForMonth('2026-08'))).toBe('Aug 2026')
    expect(periodLabel(periodForFy(2027))).toBe('FY2026–27')
    expect(periodLabel({ from: '2026-09-15', to: '2026-10-14' })).toBe('15 Sep 2026 – 14 Oct 2026')
  })
})

describe('the two bases', () => {
  // Hub24 fees debited from clients in August, paid to us on 15 September.
  const line = { received_date: '2026-09-15', generation_month: '2026-08-01' }

  it('platform money received in September was generated in August', () => {
    expect(generationMonthFor('2026-09-15', -1)).toBe('2026-08')
    expect(generationMonthFor('2026-09-15', 0)).toBe('2026-09')
  })

  it('counts the line in September on the received basis, August on the generated basis', () => {
    expect(lineMonth(line, 'received')).toBe('2026-09')
    expect(lineMonth(line, 'generated')).toBe('2026-08')
    expect(inPeriod(line, 'received', periodForMonth('2026-09'))).toBe(true)
    expect(inPeriod(line, 'received', periodForMonth('2026-08'))).toBe(false)
    expect(inPeriod(line, 'generated', periodForMonth('2026-08'))).toBe(true)
    expect(inPeriod(line, 'generated', periodForMonth('2026-09'))).toBe(false)
  })

  it('a custom range covers whole months on the generated basis', () => {
    const p = { from: '2026-08-20', to: '2026-09-10' }
    expect(inPeriod(line, 'received', p)).toBe(false)
    expect(inPeriod(line, 'generated', p)).toBe(true)
  })
})

describe('todayIso', () => {
  it('uses Sydney time', () => {
    // 31 Oct 2026 14:30 UTC is already 1 Nov in Sydney (AEDT, UTC+11).
    expect(todayIso(new Date('2026-10-31T14:30:00Z'))).toBe('2026-11-01')
  })
})
