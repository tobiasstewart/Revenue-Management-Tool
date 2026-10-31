'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { normaliseName } from '@/lib/matching'
import type { Adviser, Household } from '@/lib/types'
import { Button, inputCls } from '@/components/ui'

/**
 * Search-as-you-type household chooser with inline "new household" — matching
 * a statement line is where most new clients first turn up.
 */
export function HouseholdPicker({
  households,
  advisers,
  value,
  suggestedName,
  onChange,
  onCreate,
  disabled,
}: {
  households: Household[]
  advisers: Adviser[]
  value: string | null
  /** Pre-fills the search and the new-household name (the statement's client name). */
  suggestedName?: string | null
  onChange: (householdId: string | null) => void
  onCreate: (name: string, adviserId: string | null) => Promise<Household | null>
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newAdviser, setNewAdviser] = useState<string>('')
  const ref = useRef<HTMLDivElement>(null)
  const current = households.find((h) => h.id === value)
  const adviserName = new Map(advisers.map((a) => [a.id, a.name]))

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setCreating(false)
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const results = useMemo(() => {
    const q = normaliseName(query)
    const tokens = q.split(' ').filter(Boolean)
    const list = households.filter((h) => h.is_active || h.id === value)
    if (!tokens.length) return list.slice(0, 8)
    return list.filter((h) => {
      const n = normaliseName(h.name)
      return tokens.every((t) => n.includes(t))
    }).slice(0, 8)
  }, [query, households, value])

  function openPicker() {
    setQuery('')
    setNewName(suggestedName ?? '')
    setOpen(true)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={openPicker}
        className={`${inputCls} w-full min-w-[11rem] text-left truncate ${current ? '' : 'text-amber-700'}`}
      >
        {current ? current.name : 'Choose household…'}
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-72 bg-white border border-gray-200 rounded shadow-lg p-2">
          {!creating ? (
            <>
              <input
                autoFocus
                className={`${inputCls} w-full`}
                placeholder="Search households"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <ul className="max-h-64 overflow-auto mt-1">
                {results.map((h) => (
                  <li key={h.id}>
                    <button
                      type="button"
                      className="w-full text-left px-2 py-1.5 text-sm hover:bg-brand-light rounded"
                      onClick={() => { onChange(h.id); setOpen(false) }}
                    >
                      <div>{h.name}</div>
                      <div className="text-xs text-gray-500">{h.adviser_id ? adviserName.get(h.adviser_id) : 'No adviser'}</div>
                    </button>
                  </li>
                ))}
                {!results.length && <li className="px-2 py-1.5 text-sm text-gray-500">No match</li>}
              </ul>
              <div className="flex justify-between border-t border-gray-100 pt-2 mt-1">
                <button type="button" className="text-sm text-brand font-medium" onClick={() => { setNewName(query || suggestedName || ''); setCreating(true) }}>
                  + New household
                </button>
                {value && (
                  <button type="button" className="text-sm text-gray-500" onClick={() => { onChange(null); setOpen(false) }}>
                    Clear match
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <input autoFocus className={`${inputCls} w-full`} placeholder="Household name" value={newName} onChange={(e) => setNewName(e.target.value)} />
              <select className={`${inputCls} w-full`} value={newAdviser} onChange={(e) => setNewAdviser(e.target.value)}>
                <option value="">Adviser…</option>
                {advisers.filter((a) => a.is_active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <div className="flex gap-2 justify-end">
                <Button variant="secondary" onClick={() => setCreating(false)}>Back</Button>
                <Button
                  disabled={!newName.trim()}
                  onClick={async () => {
                    const h = await onCreate(newName.trim(), newAdviser || null)
                    if (h) { onChange(h.id); setOpen(false); setCreating(false) }
                  }}
                >
                  Create &amp; match
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
