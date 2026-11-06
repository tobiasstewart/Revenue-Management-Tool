/**
 * Matching a statement line to a client household.
 *
 * Exact keys only are applied automatically — a provider account/policy
 * number learnt earlier, a provider's spelling of the client name learnt
 * earlier, or a unique exact household name. A looser name match is returned
 * as a SUGGESTION for a person to accept: a wrong automatic match pays the
 * wrong adviser.
 */

export type ReferenceKind = 'reference' | 'name'

export interface ClientReference {
  household_id: string
  provider_id: string | null
  kind: ReferenceKind
  reference: string // stored normalised
}

export interface HouseholdLite {
  id: string
  name: string
  is_active: boolean
}

export type MatchMethod = 'reference' | 'name_alias' | 'household_name'

export interface MatchResult {
  householdId: string | null
  method: MatchMethod | null
  suggestionId: string | null
}

/** Account / policy numbers: upper-case, separators removed. */
export function normaliseRef(raw: string | null | undefined): string {
  return (raw ?? '').toUpperCase().replace(/[\s\-./\\_]/g, '')
}

const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'mx', 'dr', 'prof', 'sir'])
// Words that label a name rather than form part of it — the firm's household
// list reads "JOHN & MARY SMITH HOUSEHOLD" while statements print "Smith, John".
const JOINERS = new Set(['and', 'the', 'household', 'family'])

function nameTokens(raw: string | null | undefined): string[] {
  return (raw ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t && !TITLES.has(t) && !JOINERS.has(t))
}

/** Names: titles/punctuation dropped, tokens sorted — "SMITH, Mr John" ≡ "John Smith". */
export function normaliseName(raw: string | null | undefined): string {
  return Array.from(new Set(nameTokens(raw))).sort().join(' ')
}

export function buildMatcher(refs: ClientReference[], households: HouseholdLite[]) {
  const byRef = new Map<string, string>()
  const byName = new Map<string, string>()
  for (const r of refs) {
    const key = `${r.provider_id ?? '*'}|${r.reference}`
    ;(r.kind === 'reference' ? byRef : byName).set(key, r.household_id)
  }

  // Exact household-name index; a name shared by two households is ambiguous.
  const byHouseholdName = new Map<string, string | null>()
  const tokenSets: { id: string; tokens: Set<string> }[] = []
  for (const h of households) {
    const n = normaliseName(h.name)
    if (!n) continue
    byHouseholdName.set(n, byHouseholdName.has(n) ? null : h.id)
    tokenSets.push({ id: h.id, tokens: new Set(nameTokens(h.name)) })
  }

  return function match(
    providerId: string,
    rawReference: string | null | undefined,
    rawName: string | null | undefined
  ): MatchResult {
    const ref = normaliseRef(rawReference)
    if (ref) {
      const hit = byRef.get(`${providerId}|${ref}`) ?? byRef.get(`*|${ref}`)
      if (hit) return { householdId: hit, method: 'reference', suggestionId: null }
    }

    const name = normaliseName(rawName)
    if (!name) return { householdId: null, method: null, suggestionId: null }

    const alias = byName.get(`${providerId}|${name}`) ?? byName.get(`*|${name}`)
    if (alias) return { householdId: alias, method: 'name_alias', suggestionId: null }

    const exact = byHouseholdName.get(name)
    if (exact) return { householdId: exact, method: 'household_name', suggestionId: null }

    // Suggestion: every token of the statement's name appears in exactly one
    // household's name ("John Smith" → "John & Mary Smith"). Needs 2+ tokens.
    const tokens = nameTokens(rawName)
    let suggestion: string | null = null
    if (tokens.length >= 2) {
      const hits = tokenSets.filter((h) => tokens.every((t) => h.tokens.has(t)))
      if (hits.length === 1) suggestion = hits[0].id
    }
    return { householdId: null, method: null, suggestionId: suggestion }
  }
}

// ── Advisers ────────────────────────────────────────────────
// Statements name the adviser the provider paid (an adviser number and/or
// name). Learnt per provider; the first time, a person maps each one.

export interface AdviserReference {
  adviser_id: string
  provider_id: string | null
  kind: 'code' | 'name'
  reference: string // stored normalised
}

export interface AdviserLite {
  id: string
  name: string
  is_active: boolean
}

export type AdviserMatchMethod = 'code' | 'name_alias' | 'adviser_name'

export function buildAdviserMatcher(refs: AdviserReference[], advisers: AdviserLite[]) {
  const byCode = new Map<string, string>()
  const byName = new Map<string, string>()
  for (const r of refs) {
    ;(r.kind === 'code' ? byCode : byName).set(`${r.provider_id ?? '*'}|${r.reference}`, r.adviser_id)
  }
  const byAdviserName = new Map<string, string | null>()
  for (const a of advisers) {
    const n = normaliseName(a.name)
    if (n) byAdviserName.set(n, byAdviserName.has(n) ? null : a.id)
  }

  return function match(
    providerId: string,
    rawCode: string | null | undefined,
    rawName: string | null | undefined
  ): { adviserId: string | null; method: AdviserMatchMethod | null } {
    const code = normaliseRef(rawCode)
    if (code) {
      const hit = byCode.get(`${providerId}|${code}`) ?? byCode.get(`*|${code}`)
      if (hit) return { adviserId: hit, method: 'code' }
    }
    const name = normaliseName(rawName)
    if (name) {
      const alias = byName.get(`${providerId}|${name}`) ?? byName.get(`*|${name}`)
      if (alias) return { adviserId: alias, method: 'name_alias' }
      const exact = byAdviserName.get(name)
      if (exact) return { adviserId: exact, method: 'adviser_name' }
    }
    return { adviserId: null, method: null }
  }
}

/** The distinct advisers a statement names, keyed for the mapping table. */
export function statementAdvisers(
  lines: { adviserCode: string; adviserName: string; amountCents: number }[]
): { key: string; code: string; name: string; lines: number; amountCents: number }[] {
  const out = new Map<string, { key: string; code: string; name: string; lines: number; amountCents: number }>()
  for (const l of lines) {
    if (!l.adviserCode && !l.adviserName) continue
    const key = adviserKey(l.adviserCode, l.adviserName)
    const row = out.get(key) ?? { key, code: l.adviserCode, name: l.adviserName, lines: 0, amountCents: 0 }
    row.lines++
    row.amountCents += l.amountCents
    out.set(key, row)
  }
  return [...out.values()]
}

/** Identity of a statement adviser: the code when there is one, else the name. */
export function adviserKey(code: string | null | undefined, name: string | null | undefined): string {
  const c = normaliseRef(code)
  return c ? `code:${c}` : `name:${normaliseName(name)}`
}
