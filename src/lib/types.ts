import type { FeeType } from './fee-type'
import type { ImportMapping } from './import/mapping'
import type { ReferenceKind } from './matching'

/** Row shapes as stored (supabase/migrations/003). Money in CENTS. */

export type ProviderType =
  | 'platform'
  | 'insurer'
  | 'annuity'
  | 'investment_bond'
  | 'direct_debit'
  | 'client_direct'
  | 'other'

export const PROVIDER_TYPE_LABELS: Record<ProviderType, string> = {
  platform: 'Platform',
  insurer: 'Insurer',
  annuity: 'Annuity provider',
  investment_bond: 'Investment bond provider',
  direct_debit: 'Direct debit (e.g. Ezidebit)',
  client_direct: 'Client direct deposit',
  other: 'Other',
}

/** Default revenue-month offset by provider type: platforms, annuity and bond
 *  providers pay this month for LAST month's fees; the rest relate to the
 *  month received. Editable per provider. */
export const DEFAULT_OFFSET: Record<ProviderType, number> = {
  platform: -1,
  annuity: -1,
  investment_bond: -1,
  insurer: 0,
  direct_debit: 0,
  client_direct: 0,
  other: 0,
}

export interface Adviser {
  id: string
  name: string
  email: string | null
  upfront_split_pct: number | null
  is_active: boolean
}

export interface Shareholder {
  id: string
  name: string
  share_pct: number
  effective_from: string
  effective_to: string | null
}

export interface Household {
  id: string
  name: string
  adviser_id: string | null
  is_active: boolean
  notes: string | null
}

export interface Provider {
  id: string
  name: string
  provider_type: ProviderType
  generation_offset_months: number
  import_mapping: ImportMapping | null
  is_active: boolean
}

export interface ClientReferenceRow {
  id: string
  household_id: string
  provider_id: string | null
  kind: ReferenceKind
  reference: string
  label: string | null
}

export interface Statement {
  id: string
  provider_id: string
  source: 'upload' | 'manual'
  received_date: string
  generation_month: string
  statement_ref: string | null
  file_name: string | null
  storage_path: string | null
  deposit_amount_cents: number | null
  status: 'draft' | 'finalised'
  notes: string | null
  created_at: string
}

export interface StatementSummary {
  statement_id: string
  line_count: number
  amount_cents: number
  gst_cents: number
  unmatched_count: number
  unclassified_count: number
}

export interface RevenueLine {
  id: string
  statement_id: string
  provider_id: string
  received_date: string
  generation_month: string
  household_id: string | null
  adviser_id: string | null
  match_status: 'unmatched' | 'auto' | 'manual'
  fee_type: FeeType | null
  adviser_split_pct: number | null
  adviser_source: 'statement' | 'household' | 'manual' | null
  raw_adviser_code: string | null
  raw_adviser_name: string | null
  amount_cents: number
  gst_cents: number
  raw_client_name: string | null
  raw_reference: string | null
  raw_fee_type: string | null
  product: string | null
  description: string | null
  row_number: number | null
}

export interface FirmSettings {
  firm_id: string
  upfront_adviser_pct: number
  one_off_adviser_pct: number
}
