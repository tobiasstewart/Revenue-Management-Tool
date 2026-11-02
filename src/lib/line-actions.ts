import type { SupabaseClient } from '@supabase/supabase-js'
import { LINE_COLUMNS } from './data'
import type { FeeType } from './fee-type'
import { normaliseFeeText } from './fee-type'
import { adviserKey, normaliseName, normaliseRef } from './matching'
import type { Household, Provider, RevenueLine } from './types'

export type LinePatch = Partial<Pick<RevenueLine, 'household_id' | 'adviser_id' | 'adviser_source' | 'fee_type' | 'generation_month'>>

/** Update lines and read them back — the trigger derives adviser + split. */
export async function updateLines(supabase: SupabaseClient, ids: string[], patch: LinePatch): Promise<RevenueLine[]> {
  if (!ids.length) return []
  const { data, error } = await supabase.from('revenue_lines').update(patch).in('id', ids).select(LINE_COLUMNS)
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as RevenueLine[]
}

/** The key that identifies "the same client" on a provider's statements. */
export function clientKey(l: Pick<RevenueLine, 'provider_id' | 'raw_reference' | 'raw_client_name'>): string | null {
  const ref = normaliseRef(l.raw_reference)
  if (ref) return `${l.provider_id}|ref|${ref}`
  const name = normaliseName(l.raw_client_name)
  return name ? `${l.provider_id}|name|${name}` : null
}

/** Learn this line's account/policy number (or, failing that, its client
 *  name) for the provider, so future statements match automatically. */
export async function rememberMatch(supabase: SupabaseClient, line: RevenueLine, householdId: string): Promise<void> {
  const ref = normaliseRef(line.raw_reference)
  const name = normaliseName(line.raw_client_name)
  if (!ref && !name) return
  const row = ref
    ? { household_id: householdId, provider_id: line.provider_id, kind: 'reference', reference: ref, label: line.raw_reference }
    : { household_id: householdId, provider_id: line.provider_id, kind: 'name', reference: name, label: line.raw_client_name }
  // Re-pointing an existing key to a different household is a deliberate correction.
  const { data: existing } = await supabase
    .from('client_references')
    .select('id')
    .eq('provider_id', row.provider_id)
    .eq('kind', row.kind)
    .eq('reference', row.reference)
    .maybeSingle()
  const res = existing
    ? await supabase.from('client_references').update({ household_id: householdId }).eq('id', existing.id)
    : await supabase.from('client_references').insert(row)
  if (res.error) throw new Error(res.error.message)
}

/** Learn which of our advisers a provider's adviser code (or name) is. */
export async function rememberAdviser(supabase: SupabaseClient, line: RevenueLine, adviserId: string): Promise<void> {
  const code = normaliseRef(line.raw_adviser_code)
  const name = normaliseName(line.raw_adviser_name)
  if (!code && !name) return
  const row = code
    ? { adviser_id: adviserId, provider_id: line.provider_id, kind: 'code', reference: code,
        label: [line.raw_adviser_code, line.raw_adviser_name].filter(Boolean).join(' — ') }
    : { adviser_id: adviserId, provider_id: line.provider_id, kind: 'name', reference: name, label: line.raw_adviser_name }
  const { data: existing } = await supabase
    .from('adviser_references')
    .select('id')
    .eq('provider_id', row.provider_id)
    .eq('kind', row.kind)
    .eq('reference', row.reference)
    .maybeSingle()
  const res = existing
    ? await supabase.from('adviser_references').update({ adviser_id: adviserId, label: row.label }).eq('id', existing.id)
    : await supabase.from('adviser_references').insert(row)
  if (res.error) throw new Error(res.error.message)
}

/** "The same statement adviser" on a provider's lines, or null if none named. */
export function statementAdviserKey(l: Pick<RevenueLine, 'provider_id' | 'raw_adviser_code' | 'raw_adviser_name'>): string | null {
  if (!l.raw_adviser_code && !l.raw_adviser_name) return null
  return `${l.provider_id}|${adviserKey(l.raw_adviser_code, l.raw_adviser_name)}`
}

/** Record a provider's fee wording → type so the next import classifies it. */
export async function rememberFeeType(supabase: SupabaseClient, provider: Provider, rawFeeType: string, feeType: FeeType) {
  const key = normaliseFeeText(rawFeeType)
  if (!key || !provider.import_mapping) return provider
  const mapping = {
    ...provider.import_mapping,
    feeTypeValues: { ...provider.import_mapping.feeTypeValues, [key]: feeType },
  }
  const { error } = await supabase.from('providers').update({ import_mapping: mapping }).eq('id', provider.id)
  if (error) throw new Error(error.message)
  return { ...provider, import_mapping: mapping }
}

export async function createHousehold(supabase: SupabaseClient, name: string, adviserId: string | null): Promise<Household> {
  const { data, error } = await supabase
    .from('households')
    .insert({ name, adviser_id: adviserId })
    .select('id, name, adviser_id, is_active, notes')
    .single()
  if (error) throw new Error(error.message)
  return data as Household
}
