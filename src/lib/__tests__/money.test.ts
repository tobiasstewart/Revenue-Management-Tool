import { describe, it, expect } from 'vitest'
import { parseAmountToCents, pctOfCents, splitGstInclusive, fmtMoney } from '../money'

describe('parseAmountToCents', () => {
  it.each([
    [1234.56, 123456],
    ['$1,234.56', 123456],
    ['1234.5', 123450],
    [' 99 ', 9900],
    ['(12.00)', -1200],
    ['12.00-', -1200],
    ['-$5.10', -510],
    ['AUD 99.95', 9995],
    ['.5', 50],
    [0.1 + 0.2, 30],
  ])('%s → %s', (input, cents) => {
    expect(parseAmountToCents(input)).toBe(cents)
  })

  it.each([null, undefined, '', '  ', 'n/a', '12a', '1.2.3'])('%s → null', (input) => {
    expect(parseAmountToCents(input)).toBeNull()
  })
})

describe('pctOfCents', () => {
  it('takes 60% of an upfront to the cent', () => {
    expect(pctOfCents(330000, 60)).toBe(198000)
    expect(pctOfCents(12345, 60)).toBe(7407)
    expect(pctOfCents(-12345, 60)).toBe(-7407) // clawbacks round symmetrically
  })
})

describe('splitGstInclusive', () => {
  it('takes 1/11 as GST', () => {
    expect(splitGstInclusive(110000)).toEqual({ exCents: 100000, gstCents: 10000 })
    expect(splitGstInclusive(-1100)).toEqual({ exCents: -1000, gstCents: -100 })
  })
})

describe('fmtMoney', () => {
  it('formats AUD to 2dp', () => {
    expect(fmtMoney(123456)).toBe('$1,234.56')
    expect(fmtMoney(null)).toBe('—')
  })
})
