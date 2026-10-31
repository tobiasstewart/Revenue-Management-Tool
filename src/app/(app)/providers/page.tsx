'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import { errorMessage } from '@/lib/data'
import { DEFAULT_OFFSET, PROVIDER_TYPE_LABELS, type Provider, type ProviderType } from '@/lib/types'
import { Badge, Button, Card, Empty, ErrorBanner, Loading, PageHeader, inputCls, tdCls, thCls } from '@/components/ui'

const OFFSETS = [
  { value: 0, label: 'Same month as received' },
  { value: -1, label: 'Month before received' },
  { value: -2, label: 'Two months before' },
  { value: -3, label: 'Three months before' },
]

function OffsetSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <select className={inputCls} value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {OFFSETS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

export default function ProvidersPage() {
  const supabase = useMemo(() => createClient(), [])
  const [providers, setProviders] = useState<Provider[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ name: string; provider_type: ProviderType; generation_offset_months: number }>({
    name: '', provider_type: 'platform', generation_offset_months: DEFAULT_OFFSET.platform,
  })

  useEffect(() => {
    supabase.from('providers').select('*').order('name').then(({ data, error }) => {
      if (error) setError(error.message)
      else setProviders(data)
    })
  }, [supabase])

  async function add() {
    setError(null)
    const { data, error } = await supabase.from('providers').insert({ ...draft, name: draft.name.trim() }).select('*').single()
    if (error) return setError(error.code === '23505' ? 'A provider with that name already exists' : error.message)
    setProviders((p) => [...(p ?? []), data].sort((a, b) => a.name.localeCompare(b.name)))
    setDraft({ ...draft, name: '' })
  }

  async function update(id: string, patch: Partial<Provider>) {
    setError(null)
    const { data, error } = await supabase.from('providers').update(patch).eq('id', id).select('*').single()
    if (error) return setError(errorMessage(error))
    setProviders((p) => p!.map((x) => (x.id === id ? data : x)))
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Providers" sub="Platforms, insurers, annuity and bond providers, direct-debit services and direct client deposits." />
      <ErrorBanner error={error} />
      <Card title="Add provider">
        <div className="flex flex-wrap gap-2">
          <input className={`${inputCls} w-56`} placeholder="Name, e.g. Hub24" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <select
            className={inputCls}
            value={draft.provider_type}
            onChange={(e) => {
              const t = e.target.value as ProviderType
              setDraft({ ...draft, provider_type: t, generation_offset_months: DEFAULT_OFFSET[t] })
            }}
          >
            {(Object.keys(PROVIDER_TYPE_LABELS) as ProviderType[]).map((t) => <option key={t} value={t}>{PROVIDER_TYPE_LABELS[t]}</option>)}
          </select>
          <OffsetSelect value={draft.generation_offset_months} onChange={(v) => setDraft({ ...draft, generation_offset_months: v })} />
          <Button disabled={!draft.name.trim()} onClick={add}>Add</Button>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          &ldquo;Revenue month&rdquo; sets the generated basis: Hub24 pays in September for fees debited from clients in August, so its revenue month is the month before received. Each statement can still be adjusted.
        </p>
      </Card>
      <Card title="Providers">
        {!providers ? <Loading /> : !providers.length ? <Empty>No providers yet.</Empty> : (
          <table className="min-w-full">
            <thead><tr>
              <th className={thCls}>Name</th><th className={thCls}>Type</th><th className={thCls}>Revenue month</th>
              <th className={thCls}>Statement layout</th><th className={thCls}>Status</th><th className={thCls}></th>
            </tr></thead>
            <tbody>
              {providers.map((p, i) => (
                <tr key={p.id} className={i % 2 ? 'bg-row' : 'bg-white'}>
                  <td className={tdCls}>
                    <input className={`${inputCls} w-48`} defaultValue={p.name} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== p.name && update(p.id, { name: e.target.value.trim() })} />
                  </td>
                  <td className={tdCls}>
                    <select className={inputCls} value={p.provider_type} onChange={(e) => update(p.id, { provider_type: e.target.value as ProviderType })}>
                      {(Object.keys(PROVIDER_TYPE_LABELS) as ProviderType[]).map((t) => <option key={t} value={t}>{PROVIDER_TYPE_LABELS[t]}</option>)}
                    </select>
                  </td>
                  <td className={tdCls}><OffsetSelect value={p.generation_offset_months} onChange={(v) => update(p.id, { generation_offset_months: v })} /></td>
                  <td className={tdCls}>
                    {p.import_mapping ? (
                      <span className="flex items-center gap-2">
                        <Badge tone="brand">saved</Badge>
                        <button type="button" className="text-xs text-gray-500 hover:text-negative" onClick={() => confirm(`Forget ${p.name}'s saved column layout and fee-type wording?`) && update(p.id, { import_mapping: null })}>forget</button>
                      </span>
                    ) : <span className="text-xs text-gray-500">set on first upload</span>}
                  </td>
                  <td className={tdCls}>
                    <select className={inputCls} value={p.is_active ? 'a' : 'i'} onChange={(e) => update(p.id, { is_active: e.target.value === 'a' })}>
                      <option value="a">Active</option><option value="i">Inactive</option>
                    </select>
                  </td>
                  <td className={tdCls}><Link href={`/statements/new?provider=${p.id}`} className="text-sm text-accent hover:underline whitespace-nowrap">Upload →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}
