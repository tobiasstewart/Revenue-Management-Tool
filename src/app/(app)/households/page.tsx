'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import { byId, errorMessage, loadLookups, type Lookups } from '@/lib/data'
import { createHousehold } from '@/lib/line-actions'
import { normaliseName } from '@/lib/matching'
import { Badge, Button, Card, Empty, ErrorBanner, Loading, PageHeader, inputCls, tdCls, thCls } from '@/components/ui'

export default function HouseholdsPage() {
  const supabase = useMemo(() => createClient(), [])
  const [lookups, setLookups] = useState<Lookups | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [adviserFilter, setAdviserFilter] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [name, setName] = useState('')
  const [adviserId, setAdviserId] = useState('')

  useEffect(() => {
    loadLookups(supabase).then(setLookups).catch((e) => setError(errorMessage(e)))
  }, [supabase])

  if (!lookups) return <><ErrorBanner error={error} /><Loading /></>
  const advisers = byId(lookups.advisers)
  const tokens = normaliseName(query).split(' ').filter(Boolean)
  const shown = lookups.households.filter((h) =>
    (showInactive || h.is_active) &&
    (!adviserFilter || (adviserFilter === 'none' ? !h.adviser_id : h.adviser_id === adviserFilter)) &&
    tokens.every((t) => normaliseName(h.name).includes(t))
  )

  async function add() {
    setError(null)
    try {
      const h = await createHousehold(supabase, name.trim(), adviserId || null)
      setLookups((l) => l && ({ ...l, households: [...l.households, h].sort((a, b) => a.name.localeCompare(b.name)) }))
      setName('')
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Households" sub="Clients, and the adviser their revenue is attributed to." />
      <ErrorBanner error={error} />
      <Card title="Add household">
        <div className="flex flex-wrap gap-2">
          <input className={`${inputCls} w-72`} placeholder="Household name, e.g. John & Mary Smith" value={name} onChange={(e) => setName(e.target.value)} />
          <select className={inputCls} value={adviserId} onChange={(e) => setAdviserId(e.target.value)}>
            <option value="">Adviser…</option>
            {lookups.advisers.filter((a) => a.is_active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <Button disabled={!name.trim()} onClick={add}>Add</Button>
        </div>
      </Card>
      <Card
        title={`${shown.length} household${shown.length === 1 ? '' : 's'}`}
        actions={
          <div className="flex flex-wrap gap-2 items-center">
            <input className={inputCls} placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
            <select className={inputCls} value={adviserFilter} onChange={(e) => setAdviserFilter(e.target.value)}>
              <option value="">All advisers</option>
              <option value="none">No adviser</option>
              {lookups.advisers.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <label className="text-sm flex items-center gap-1"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Inactive</label>
          </div>
        }
      >
        {!shown.length ? <Empty>No households yet — add one above, or create them while matching statement lines.</Empty> : (
          <table className="min-w-full">
            <thead><tr><th className={thCls}>Household</th><th className={thCls}>Adviser</th><th className={thCls}>Status</th></tr></thead>
            <tbody>
              {shown.map((h, i) => (
                <tr key={h.id} className={i % 2 ? 'bg-row' : 'bg-white'}>
                  <td className={tdCls}><Link href={`/households/${h.id}`} className="text-accent font-medium hover:underline">{h.name}</Link></td>
                  <td className={tdCls}>{h.adviser_id ? advisers.get(h.adviser_id)?.name : <Badge tone="warn">no adviser</Badge>}</td>
                  <td className={tdCls}>{h.is_active ? 'Active' : <Badge>inactive</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}
