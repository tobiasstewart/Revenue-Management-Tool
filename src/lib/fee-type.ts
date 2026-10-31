/**
 * Fee types drive the adviser split: an adviser keeps a share of UPFRONT (and,
 * by firm setting, ONE-OFF) revenue; ONGOING revenue — ongoing fees, renewal
 * and trail commission — goes entirely to the business.
 */

export type FeeType = 'upfront' | 'ongoing' | 'one_off'

export const FEE_TYPES: FeeType[] = ['upfront', 'ongoing', 'one_off']

export const FEE_TYPE_LABELS: Record<FeeType, string> = {
  upfront: 'Upfront',
  ongoing: 'Ongoing',
  one_off: 'One-off',
}

/** Lower-case, punctuation to spaces, collapsed — the key for value mappings. */
export function normaliseFeeText(raw: string | null | undefined): string {
  return (raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// Checked in this order: "one-off" wording first (it often sits beside
// "upfront"), then upfront, then ongoing. Deliberately conservative — text we
// don't recognise is left unclassified for a person to decide, because a wrong
// guess moves money between an adviser and the business.
const RULES: { type: FeeType; patterns: RegExp[] }[] = [
  {
    type: 'one_off',
    patterns: [/\bone ?off\b/, /\bonce off\b/, /\bad ?hoc\b/, /\bone time\b/],
  },
  {
    type: 'upfront',
    patterns: [
      /\bup ?front\b/,
      /\binitial\b/,
      /\bfirst year\b/,
      /\bnew business\b/,
      /\bestablishment\b/,
      /\bimplementation\b/,
    ],
  },
  {
    type: 'ongoing',
    patterns: [/\bongoing\b/, /\brenewal\b/, /\btrail\b/, /\blevel\b/, /\brecurring\b/],
  },
]

/**
 * Classify a provider's fee/commission description. A per-provider mapping
 * (normalised text → type, learnt at import) wins over the keyword rules.
 * Returns null when nothing matches.
 */
export function classifyFeeType(
  raw: string | null | undefined,
  mapping?: Record<string, FeeType> | null
): FeeType | null {
  const norm = normaliseFeeText(raw)
  if (!norm) return null
  if (mapping && mapping[norm]) return mapping[norm]
  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(norm))) return rule.type
  }
  return null
}
