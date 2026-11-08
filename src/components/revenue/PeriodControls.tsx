'use client'

import { clsx } from 'clsx'
import {
  BASIS_HELP, BASIS_LABELS, addMonths, fyLabel, fyOf, monthLabel, monthKey, periodForFy, periodForMonth,
  todayIso, type Basis, type MonthKey, type Period,
} from '@/lib/periods'
import { inputCls } from '@/components/ui'

export function BasisToggle({ basis, onChange }: { basis: Basis; onChange: (b: Basis) => void }) {
  return (
    <div className="inline-flex rounded border border-gray-300 overflow-hidden text-sm" title={BASIS_HELP[basis]}>
      {(['received', 'generated'] as Basis[]).map((b) => (
        <button
          key={b}
          type="button"
          onClick={() => onChange(b)}
          className={clsx('px-3 py-1.5', basis === b ? 'bg-brand text-white' : 'bg-white text-gray-700 hover:bg-gray-50')}
        >
          {BASIS_LABELS[b]}
        </button>
      ))}
    </div>
  )
}

/** The last 36 months plus the next 2, newest first. */
export function recentMonths(): MonthKey[] {
  const now = monthKey(todayIso())
  return Array.from({ length: 38 }, (_, i) => addMonths(now, 2 - i))
}

export function MonthSelect({ value, onChange, className, disabled }: { value: MonthKey; onChange: (m: MonthKey) => void; className?: string; disabled?: boolean }) {
  const months = recentMonths()
  if (!months.includes(value)) months.push(value)
  return (
    <select className={clsx(inputCls, className)} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {months.map((m) => (
        <option key={m} value={m}>{monthLabel(m)}</option>
      ))}
    </select>
  )
}

export type PeriodMode = 'month' | 'fy' | 'custom'

export interface PeriodState {
  mode: PeriodMode
  month: MonthKey
  fy: number
  from: string
  to: string
}

export function initialPeriodState(): PeriodState {
  const prev = addMonths(todayIso(), -1)
  const p = periodForMonth(prev)
  return { mode: 'month', month: prev, fy: fyOf(todayIso()), from: p.from, to: p.to }
}

export function resolvePeriod(s: PeriodState): Period {
  if (s.mode === 'month') return periodForMonth(s.month)
  if (s.mode === 'fy') return periodForFy(s.fy)
  return s.from <= s.to ? { from: s.from, to: s.to } : { from: s.to, to: s.from }
}

export function PeriodPicker({ state, onChange }: { state: PeriodState; onChange: (s: PeriodState) => void }) {
  const thisFy = fyOf(todayIso())
  const fys = Array.from({ length: 6 }, (_, i) => thisFy - i)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select className={inputCls} value={state.mode} onChange={(e) => onChange({ ...state, mode: e.target.value as PeriodMode })}>
        <option value="month">Month</option>
        <option value="fy">Financial year</option>
        <option value="custom">Custom dates</option>
      </select>
      {state.mode === 'month' && <MonthSelect value={state.month} onChange={(month) => onChange({ ...state, month })} />}
      {state.mode === 'fy' && (
        <select className={inputCls} value={state.fy} onChange={(e) => onChange({ ...state, fy: Number(e.target.value) })}>
          {fys.map((fy) => <option key={fy} value={fy}>{fyLabel(fy)}</option>)}
        </select>
      )}
      {state.mode === 'custom' && (
        <>
          <input type="date" className={inputCls} value={state.from} onChange={(e) => onChange({ ...state, from: e.target.value })} />
          <span className="text-sm text-gray-500">to</span>
          <input type="date" className={inputCls} value={state.to} onChange={(e) => onChange({ ...state, to: e.target.value })} />
        </>
      )}
    </div>
  )
}
