import { describe, it, expect } from 'vitest'
import { buildMatcher, normaliseName, normaliseRef } from '../matching'

describe('normalisation', () => {
  it('references ignore separators and case', () => {
    expect(normaliseRef(' ab-123 456/7 ')).toBe('AB1234567')
  })
  it('names ignore titles, punctuation and order', () => {
    expect(normaliseName('SMITH, Mr John')).toBe('john smith')
    expect(normaliseName('John & Mary Smith')).toBe('john mary smith')
  })
})

describe('buildMatcher', () => {
  const households = [
    { id: 'h1', name: 'John & Mary Smith', is_active: true },
    { id: 'h2', name: 'Jane Citizen', is_active: true },
    { id: 'h3', name: 'Lee Wong', is_active: true },
    { id: 'h4', name: 'Lee Wong', is_active: true },
  ]
  const refs = [
    { household_id: 'h1', provider_id: 'hub24', kind: 'reference' as const, reference: 'IA123456' },
    { household_id: 'h2', provider_id: null, kind: 'reference' as const, reference: 'POL999' },
    { household_id: 'h2', provider_id: 'tal', kind: 'name' as const, reference: 'citizen j' },
  ]
  const match = buildMatcher(refs, households)

  it('matches a learnt account number for that provider', () => {
    expect(match('hub24', 'IA-123456', 'anything')).toMatchObject({ householdId: 'h1', method: 'reference' })
  })
  it('does not use another provider\'s account number', () => {
    expect(match('macquarie', 'IA123456', '')).toMatchObject({ householdId: null })
  })
  it('a reference with no provider applies to all providers', () => {
    expect(match('zurich', 'pol 999', '')).toMatchObject({ householdId: 'h2', method: 'reference' })
  })
  it('matches a learnt name alias', () => {
    expect(match('tal', '', 'CITIZEN, J')).toMatchObject({ householdId: 'h2', method: 'name_alias' })
  })
  it('matches a unique exact household name', () => {
    expect(match('tal', '', 'Citizen, Jane')).toMatchObject({ householdId: 'h2', method: 'household_name' })
  })
  it('never auto-matches an ambiguous name', () => {
    expect(match('tal', '', 'Lee Wong')).toEqual({ householdId: null, method: null, suggestionId: null })
  })
  it('only SUGGESTS a partial name match', () => {
    expect(match('tal', '', 'Mr John Smith')).toEqual({ householdId: null, method: null, suggestionId: 'h1' })
    expect(match('tal', '', 'Smith')).toEqual({ householdId: null, method: null, suggestionId: null })
  })
})
