import type { SupabaseClient } from '@supabase/supabase-js'
import { firstOfMonth, type Basis, type Period } from './periods'
import type { Adviser, FirmSettings, Household, Provider, RevenueLine, Shareholder } from './types'

/** PostgREST caps a response at 1000 rows — page through anything unbounded. */
export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < pageSize) return out
  }
}

export const LINE_COLUMNS =
  'id, statement_id, provider_id, received_date, generation_month, household_id, adviser_id, match_status, ' +
  'fee_type, adviser_split_pct, amount_cents, gst_cents, raw_client_name, raw_reference, raw_fee_type, ' +
  'product, description, row_number, adviser_source, raw_adviser_code, raw_adviser_name'

export interface Lookups {
  providers: Provider[]
  advisers: Adviser[]
  households: Household[]
  shareholders: Shareholder[]
  settings: FirmSettings | null
}

export async function loadLookups(supabase: SupabaseClient): Promise<Lookups> {
  const [providers, advisers, households, shareholders, settings] = await Promise.all([
    supabase.from('providers').select('*').order('name'),
    supabase.from('advisers').select('*').order('name'),
    fetchAll<Household>((a, b) =>
      supabase.from('households').select('id, name, adviser_id, is_active, notes').order('name').range(a, b)
    ),
    supabase.from('shareholders').select('*').order('effective_from'),
    supabase.from('firm_settings').select('*').maybeSingle(),
  ])
  for (const r of [providers, advisers, shareholders, settings]) {
    if (r.error) throw new Error(r.error.message)
  }
  return {
    providers: providers.data ?? [],
    advisers: advisers.data ?? [],
    households,
    shareholders: shareholders.data ?? [],
    settings: settings.data,
  }
}

/** Every line in a period on the chosen basis. */
export async function loadLinesForPeriod(
  supabase: SupabaseClient,
  basis: Basis,
  period: Period
): Promise<RevenueLine[]> {
  return fetchAll<RevenueLine>((a, b) => {
    const q = supabase.from('revenue_lines').select(LINE_COLUMNS)
    const filtered =
      basis === 'received'
        ? q.gte('received_date', period.from).lte('received_date', period.to)
        : q.gte('generation_month', firstOfMonth(period.from)).lte('generation_month', firstOfMonth(period.to))
    return filtered.order('received_date').order('id').range(a, b) as unknown as PromiseLike<{
      data: RevenueLine[] | null
      error: { message: string } | null
    }>
  })
}

export function byId<T extends { id: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((r) => [r.id, r]))
}

/** Supabase errors → a sentence for the page. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
  return 'Something went wrong'
}
