import { describe, it, expect } from 'vitest'
import { classifyFeeType } from '../fee-type'

describe('classifyFeeType', () => {
  it.each([
    ['Upfront Commission', 'upfront'],
    ['Initial Advice Fee', 'upfront'],
    ['First Year Commission', 'upfront'],
    ['New Business', 'upfront'],
    ['Ongoing Advice Fee', 'ongoing'],
    ['Renewal Commission', 'ongoing'],
    ['Trail', 'ongoing'],
    ['LEVEL COMMISSION', 'ongoing'],
    ['One-off advice fee', 'one_off'],
    ['Ad hoc fee', 'one_off'],
    ['Adhoc', 'one_off'],
  ])('%s → %s', (raw, type) => {
    expect(classifyFeeType(raw)).toBe(type)
  })

  it('leaves unknown wording for a person', () => {
    expect(classifyFeeType('Adviser Service Fee')).toBeNull()
    expect(classifyFeeType('')).toBeNull()
    expect(classifyFeeType(null)).toBeNull()
  })

  it('a learnt provider mapping wins', () => {
    expect(classifyFeeType('Adviser Service Fee', { 'adviser service fee': 'ongoing' })).toBe('ongoing')
    expect(classifyFeeType('Initial', { initial: 'one_off' })).toBe('one_off')
  })
})
