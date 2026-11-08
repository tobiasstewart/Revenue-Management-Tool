'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import { byId, errorMessage, fetchAll, loadLookups, type Lookups } from '@/lib/data'
import { FEE_TYPES, FEE_TYPE_LABELS, classifyFeeType, normaliseFeeText, type FeeType } from '@/lib/fee-type'
import {
  MAPPED_FIELDS, NO_HEADER_ROW, applyMapping, detectHeaderRow, distinctFeeTexts, emptyMapping, guessAmountBasis, guessColumns, headersAt,
  type ImportMapping, type MappedField,
} from '@/lib/import/mapping'
import { STATEMENT_FORMATS, startingMapping } from '@/lib/import/formats'
import type { ParsedSheet } from '@/lib/import/cells'
import { adviserKey, buildAdviserMatcher, buildMatcher, normaliseName, normaliseRef, statementAdvisers, type AdviserReference, type ClientReference } from '@/lib/matching'
import { fmtMoney, parseAmountToCents } from '@/lib/money'
import { dateLabel, firstOfMonth, generationMonthFor, monthLabel, todayIso, type MonthKey } from '@/lib/periods'
import { PROVIDER_TYPE_LABELS } from '@/lib/types'
import { Badge, Button, Card, ErrorBanner, Field, Loading, Notice, PageHeader, inputCls, tdCls, tdNumCls, thCls, thNumCls } from '@/components/ui'
import { MonthSelect } from '@/components/revenue/PeriodControls'

const BATCH = 500

function UploadStatement() {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const params = useSearchParams()

  const [lookups, setLookups] = useState<Lookups | null>(null)
  const [refs, setRefs] = useState<ClientReference[]>([])
  const [adviserRefs, setAdviserRefs] = useState<AdviserReference[]>([])
  // Statement adviser key → adviser chosen in the mapping table ('' = none).
  const [adviserChoice, setAdviserChoice] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  const [providerId, setProviderId] = useState(params.get('provider') ?? '')
  const [receivedDate, setReceivedDate] = useState(todayIso())
  const [genMonth, setGenMonth] = useState<MonthKey | null>(null)
  const [statementRef, setStatementRef] = useState('')
  const [deposit, setDeposit] = useState('')
  const [notes, setNotes] = useState('')

  const [file, setFile] = useState<File | null>(null)
  const [parsing, setParsing] = useState(false)
  const [sheets, setSheets] = useState<ParsedSheet[] | null>(null)
  const [mapping, setMapping] = useState<ImportMapping>(emptyMapping())
  const [duplicates, setDuplicates] = useState<number>(0)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    Promise.all([
      loadLookups(supabase),
      fetchAll<ClientReference>((a, b) =>
        supabase.from('client_references').select('household_id, provider_id, kind, reference').range(a, b)
      ),
      fetchAll<AdviserReference>((a, b) =>
        supabase.from('adviser_references').select('adviser_id, provider_id, kind, reference').range(a, b)
      ),
    ])
      .then(([l, r, ar]) => { setLookups(l); setRefs(r); setAdviserRefs(ar) })
      .catch((e) => setError(errorMessage(e)))
  }, [supabase])

  const provider = lookups?.providers.find((p) => p.id === providerId) ?? null
  const autoGenMonth = provider ? generationMonthFor(receivedDate, provider.generation_offset_months) : null
  const generationMonth = genMonth ?? autoGenMonth

  // Possible double upload: same provider + same received date already saved.
  useEffect(() => {
    if (!providerId || !receivedDate) return
    supabase
      .from('statements')
      .select('id', { count: 'exact', head: true })
      .eq('provider_id', providerId)
      .eq('received_date', receivedDate)
      .then(({ count }) => setDuplicates(count ?? 0))
  }, [supabase, providerId, receivedDate])

  const sheet = sheets?.find((s) => s.name === mapping.sheetName) ?? sheets?.[0] ?? null
  const headerRow = sheet ? (mapping.headerRow ?? detectHeaderRow(sheet.rows)) : 0
  const headers = sheet ? headersAt(sheet.rows, headerRow) : []
  const result = useMemo(() => (sheet ? applyMapping(sheet.rows, { ...mapping, headerRow }) : null), [sheet, mapping, headerRow])
  const feeTexts = useMemo(() => (sheet ? distinctFeeTexts(sheet.rows, { ...mapping, headerRow }) : []), [sheet, mapping, headerRow])

  const matcher = useMemo(() => (lookups ? buildMatcher(refs, lookups.households) : null), [refs, lookups])
  const matches = useMemo(() => {
    if (!result || !matcher || !providerId) return []
    return result.lines.map((l) => matcher(providerId, l.reference, l.clientName))
  }, [result, matcher, providerId])

  // The advisers the statement names, each resolved to one of ours: a choice
  // made in the table wins, else a learnt code/name, else an exact name.
  const adviserMatcher = useMemo(() => (lookups ? buildAdviserMatcher(adviserRefs, lookups.advisers) : null), [adviserRefs, lookups])
  const stmtAdvisers = useMemo(() => {
    if (!result || !adviserMatcher || !providerId) return []
    return statementAdvisers(result.lines).map((a) => {
      const auto = adviserMatcher(providerId, a.code, a.name).adviserId
      const chosen = adviserChoice[a.key]
      return { ...a, auto, adviserId: chosen === undefined ? auto : chosen || null }
    })
  }, [result, adviserMatcher, providerId, adviserChoice])
  const adviserByKey = new Map(stmtAdvisers.map((a) => [a.key, a.adviserId]))
  const lineAdviser = (l: { adviserCode: string; adviserName: string }) =>
    l.adviserCode || l.adviserName ? adviserByKey.get(adviserKey(l.adviserCode, l.adviserName)) ?? null : null

  /**
   * Start from the provider's saved mapping if its columns still exist, else a
   * recognised statement format (lib/import/formats.ts), else guess from the
   * header text.
   */
  function adoptMapping(nextSheets: ParsedSheet[], saved: ImportMapping | null) {
    const start = startingMapping(nextSheets, saved)
    if (start) {
      setMapping(start.mapping)
      return
    }
    const s = nextSheets.find((x) => x.name === saved?.sheetName) ?? nextSheets[0]
    const columns = guessColumns(headersAt(s.rows, detectHeaderRow(s.rows)))
    setMapping({
      ...(saved ?? emptyMapping()),
      formatId: undefined,
      sheetName: s.name,
      headerRow: null,
      columns,
      amountBasis: guessAmountBasis(columns.amount),
    })
  }

  async function onFile(f: File | null) {
    setFile(f)
    setSheets(null)
    setError(null)
    if (!f) return
    setParsing(true)
    try {
      const body = new FormData()
      body.append('file', f)
      const res = await fetch('/api/statements/parse', { method: 'POST', body })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not read the file')
      setSheets(json.sheets)
      adoptMapping(json.sheets, provider?.import_mapping ?? null)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setParsing(false)
    }
  }

  function setColumn(field: MappedField, header: string) {
    setMapping((m) => ({ ...m, columns: { ...m.columns, [field]: header || undefined } }))
  }

  const recognised = mapping.formatId ? STATEMENT_FORMATS.find((f) => f.id === mapping.formatId) ?? null : null
  const depositCents = deposit.trim() ? parseAmountToCents(deposit) : null
  const totalEx = result?.lines.reduce((a, l) => a + l.amountCents, 0) ?? 0
  const totalGst = result?.lines.reduce((a, l) => a + l.gstCents, 0) ?? 0
  const matchedCount = matches.filter((m) => m.householdId).length
  const unclassifiedCount = result?.lines.filter((l) => !l.feeType).length ?? 0
  const canImport = !!provider && !!generationMonth && !!file && !!result && result.lines.length > 0 && !saving &&
    (deposit.trim() === '' || depositCents !== null)

  async function save() {
    if (!canImport || !provider || !result || !file || !generationMonth || !sheet) return
    setSaving(true)
    setError(null)
    let statementId: string | null = null
    let storagePath: string | null = null
    try {
      const { data: firmId, error: firmErr } = await supabase.rpc('get_my_firm_id')
      if (firmErr || !firmId) throw new Error('Your account is not linked to a firm')

      const { data: stmt, error: sErr } = await supabase
        .from('statements')
        .insert({
          provider_id: provider.id,
          source: 'upload',
          received_date: receivedDate,
          generation_month: firstOfMonth(generationMonth),
          statement_ref: statementRef.trim() || null,
          deposit_amount_cents: depositCents,
          notes: notes.trim() || null,
          file_name: file.name,
        })
        .select('id')
        .single()
      if (sErr) throw new Error(sErr.message)
      statementId = stmt.id as string

      const safeName = file.name.replace(/[^\w.-]+/g, '_')
      storagePath = `${firmId}/${statementId}/${safeName}`
      const up = await supabase.storage.from('statements').upload(storagePath, file, { contentType: file.type || undefined })
      if (up.error) throw new Error(`Could not store the original file: ${up.error.message}`)
      const pathErr = (await supabase.from('statements').update({ storage_path: storagePath }).eq('id', statementId)).error
      if (pathErr) throw new Error(pathErr.message)

      const rows = result.lines.map((l, i) => ({
        statement_id: statementId,
        provider_id: provider.id,
        received_date: receivedDate,
        generation_month: firstOfMonth(l.generationMonth ?? generationMonth),
        household_id: matches[i]?.householdId ?? null,
        match_status: matches[i]?.householdId ? 'auto' : 'unmatched',
        // The adviser the provider paid; with none, the trigger uses the household's.
        adviser_id: lineAdviser(l),
        adviser_source: lineAdviser(l) ? 'statement' : null,
        raw_adviser_code: l.adviserCode || null,
        raw_adviser_name: l.adviserName || null,
        fee_type: l.feeType,
        amount_cents: l.amountCents,
        gst_cents: l.gstCents,
        raw_client_name: l.clientName || null,
        raw_reference: l.reference || null,
        raw_fee_type: l.rawFeeType || null,
        product: l.product || null,
        description: l.description || null,
        row_number: l.rowNumber,
        raw: l.raw,
      }))
      for (let i = 0; i < rows.length; i += BATCH) {
        const { error: lErr } = await supabase.from('revenue_lines').insert(rows.slice(i, i + BATCH))
        if (lErr) throw new Error(lErr.message)
      }

      // Learn adviser codes/names chosen (or confirmed) for this provider.
      for (const a of stmtAdvisers) {
        if (!a.adviserId || a.adviserId === a.auto) continue
        const code = normaliseRef(a.code)
        const row = code
          ? { adviser_id: a.adviserId, provider_id: provider.id, kind: 'code', reference: code, label: [a.code, a.name].filter(Boolean).join(' — ') }
          : { adviser_id: a.adviserId, provider_id: provider.id, kind: 'name', reference: normaliseName(a.name), label: a.name }
        const { data: existing } = await supabase.from('adviser_references').select('id')
          .eq('provider_id', provider.id).eq('kind', row.kind).eq('reference', row.reference).maybeSingle()
        const res = existing
          ? await supabase.from('adviser_references').update({ adviser_id: a.adviserId, label: row.label }).eq('id', existing.id)
          : await supabase.from('adviser_references').insert(row)
        if (res.error) throw new Error(res.error.message)
      }

      // Remember the mapping (with the header row actually used) for next month.
      await supabase.from('providers').update({ import_mapping: { ...mapping, sheetName: sheet.name } }).eq('id', provider.id)

      router.push(`/statements/${statementId}`)
    } catch (e) {
      // Leave nothing half-imported behind.
      if (statementId) await supabase.from('statements').delete().eq('id', statementId)
      if (storagePath) await supabase.storage.from('statements').remove([storagePath])
      setError(errorMessage(e))
      setSaving(false)
    }
  }

  if (!lookups) return <><ErrorBanner error={error} /><Loading /></>

  const households = byId(lookups.households)
  const activeProviders = lookups.providers.filter((p) => p.is_active)

  return (
    <div className="space-y-5 max-w-6xl">
      <PageHeader title="Upload statement" sub="Commission or fee statement from a platform, insurer, annuity or bond provider, or a direct-debit report." />
      <ErrorBanner error={error} />

      <Card title="1. Statement details">
        {!activeProviders.length && (
          <Notice tone="warn">Add your providers first on the <Link className="underline" href="/providers">Providers</Link> page.</Notice>
        )}
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Provider">
            <select className={`${inputCls} w-full`} value={providerId} onChange={(e) => {
              setProviderId(e.target.value)
              setGenMonth(null)
              const next = lookups.providers.find((p) => p.id === e.target.value)
              if (sheets && next) adoptMapping(sheets, next.import_mapping)
            }}>
              <option value="">Choose…</option>
              {activeProviders.map((p) => <option key={p.id} value={p.id}>{p.name} ({PROVIDER_TYPE_LABELS[p.provider_type]})</option>)}
            </select>
          </Field>
          <Field label="Date received in bank" help="The day the money reached the bank account — the payout basis.">
            <input type="date" className={`${inputCls} w-full`} value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} />
          </Field>
          <Field
            label="Revenue month (generated)"
            help={provider ? (provider.generation_offset_months === 0
              ? `${provider.name}'s statements relate to the month received.`
              : `${provider.name} pays for fees from ${-provider.generation_offset_months} month(s) earlier.`) : 'Set by the provider.'}
          >
            {generationMonth ? (
              <MonthSelect className="w-full" value={generationMonth} onChange={setGenMonth} />
            ) : <span className="text-sm text-gray-500">Choose a provider</span>}
          </Field>
          <Field label="Bank deposit amount (incl. GST)" help="Optional — reconciled against the statement total.">
            <input className={`${inputCls} w-full`} inputMode="decimal" placeholder="e.g. 12,345.67" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
          </Field>
          <Field label="Statement reference">
            <input className={`${inputCls} w-full`} value={statementRef} onChange={(e) => setStatementRef(e.target.value)} />
          </Field>
          <Field label="Notes">
            <input className={`${inputCls} w-full`} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        {duplicates > 0 && (
          <div className="mt-3"><Notice tone="warn">
            {duplicates} statement{duplicates > 1 ? 's' : ''} from this provider received on {dateLabel(receivedDate)} already exist — check this isn&apos;t a double upload.
          </Notice></div>
        )}
        <div className="mt-4">
          <Field label="Statement file (.xlsx or .csv)">
            <input type="file" accept=".xlsx,.xlsm,.csv,.xls" disabled={!provider} onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
          </Field>
          {parsing && <p className="text-sm text-gray-500 mt-2">Reading file…</p>}
        </div>
      </Card>

      {sheet && result && (
        <Card title="2. Map the columns" actions={
          <div className="flex gap-2">
            {recognised && <Badge tone="brand">Recognised: {recognised.label}</Badge>}
            {provider?.import_mapping && <Badge tone="brand">Using {provider.name}&apos;s saved layout</Badge>}
          </div>
        }>
          <div className="grid gap-4 md:grid-cols-4 mb-4">
            {sheets!.length > 1 && (
              <Field label="Sheet">
                <select className={`${inputCls} w-full`} value={sheet.name} onChange={(e) => {
                  const s = sheets!.find((x) => x.name === e.target.value)!
                  setMapping((m) => ({ ...m, formatId: undefined, sheetName: s.name, headerRow: null, columns: guessColumns(headersAt(s.rows, detectHeaderRow(s.rows))) }))
                }}>
                  {sheets!.map((s) => <option key={s.name}>{s.name}</option>)}
                </select>
              </Field>
            )}
            <Field label="Header row" help="The row holding the column titles.">
              <div className="flex items-center gap-3">
                <input type="number" min={1} className={`${inputCls} w-24`} disabled={headerRow === NO_HEADER_ROW}
                  value={headerRow === NO_HEADER_ROW ? '' : headerRow + 1}
                  onChange={(e) => {
                    const hr = Math.max(0, Number(e.target.value) - 1)
                    setMapping((m) => ({ ...m, formatId: undefined, headerRow: hr, columns: guessColumns(headersAt(sheet.rows, hr)) }))
                  }} />
                <label className="flex items-center gap-1.5 text-sm text-gray-700">
                  <input type="checkbox" checked={headerRow === NO_HEADER_ROW}
                    onChange={(e) => {
                      const hr = e.target.checked ? NO_HEADER_ROW : Math.max(0, detectHeaderRow(sheet.rows))
                      setMapping((m) => ({ ...m, formatId: undefined, headerRow: hr, columns: e.target.checked ? {} : guessColumns(headersAt(sheet.rows, hr)) }))
                    }} />
                  None
                </label>
              </div>
            </Field>
            <Field label="Amounts are" help="If GST-inclusive with no GST column, GST is taken as 1/11.">
              <select className={`${inputCls} w-full`} value={mapping.amountBasis} onChange={(e) => setMapping((m) => ({ ...m, amountBasis: e.target.value as ImportMapping['amountBasis'] }))}>
                <option value="ex_gst">Excluding GST</option>
                <option value="incl_gst">Including GST</option>
              </select>
            </Field>
            <Field label="If fee type is unclear" help="E.g. a statement that only ever carries renewals.">
              <select className={`${inputCls} w-full`} value={mapping.defaultFeeType ?? ''} onChange={(e) => setMapping((m) => ({ ...m, defaultFeeType: (e.target.value || null) as FeeType | null }))}>
                <option value="">Leave for review</option>
                {FEE_TYPES.map((t) => <option key={t} value={t}>Treat as {FEE_TYPE_LABELS[t].toLowerCase()}</option>)}
              </select>
            </Field>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            {MAPPED_FIELDS.map(({ field, label, required, help }) => (
              <Field key={field} label={`${label}${required ? ' *' : ''}`} help={help}>
                <select className={`${inputCls} w-full`} value={mapping.columns[field] ?? ''} onChange={(e) => setColumn(field, e.target.value)}>
                  <option value="">— not on this statement —</option>
                  {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </Field>
            ))}
          </div>

          {stmtAdvisers.length > 0 && (
            <div className="mt-5">
              <h3 className="text-sm font-semibold text-gray-800 mb-2">Advisers on this statement</h3>
              <p className="text-xs text-gray-500 mb-2">
                The adviser {provider?.name} paid decides who gets the upfront split — it takes precedence over the household&apos;s adviser. Saved for future statements.
              </p>
              <div className="grid gap-2 md:grid-cols-2">
                {stmtAdvisers.map((a) => (
                  <div key={a.key} className={`flex items-center justify-between gap-3 rounded border px-3 py-2 ${a.adviserId ? 'border-gray-200' : 'border-amber-300 bg-amber-50'}`}>
                    <span className="text-sm">
                      <span className="font-medium">{a.name || a.code}</span>
                      {a.code && a.name && <span className="text-gray-500"> · {a.code}</span>}
                      <span className="block text-xs text-gray-500">{a.lines} line{a.lines > 1 ? 's' : ''} · {fmtMoney(a.amountCents)}</span>
                    </span>
                    <select
                      className={inputCls}
                      value={a.adviserId ?? ''}
                      onChange={(e) => setAdviserChoice((c) => ({ ...c, [a.key]: e.target.value }))}
                    >
                      <option value="">Not one of ours — use household&apos;s</option>
                      {lookups.advisers.filter((x) => x.is_active || x.id === a.adviserId).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              {!lookups.advisers.length && (
                <div className="mt-2"><Notice tone="warn">Add your advisers on the <Link className="underline" href="/advisers">Advisers</Link> page first so these can be matched.</Notice></div>
              )}
            </div>
          )}

          {feeTexts.length > 0 && (
            <div className="mt-5">
              <h3 className="text-sm font-semibold text-gray-800 mb-2">Fee types on this statement</h3>
              <p className="text-xs text-gray-500 mb-2">How each of {provider?.name}&apos;s descriptions should be treated. Saved for future statements.</p>
              <div className="grid gap-2 md:grid-cols-2">
                {feeTexts.map((t) => {
                  const key = normaliseFeeText(t)
                  const auto = classifyFeeType(t)
                  return (
                    <div key={key} className="flex items-center justify-between gap-3 rounded border border-gray-200 px-3 py-2">
                      <span className="text-sm">{t}</span>
                      <select
                        className={inputCls}
                        value={mapping.feeTypeValues[key] ?? ''}
                        onChange={(e) => setMapping((m) => {
                          const v = { ...m.feeTypeValues }
                          if (e.target.value) v[key] = e.target.value as FeeType
                          else delete v[key]
                          return { ...m, feeTypeValues: v }
                        })}
                      >
                        <option value="">{auto ? `Auto: ${FEE_TYPE_LABELS[auto]}` : 'Unknown — review'}</option>
                        {FEE_TYPES.map((ft) => <option key={ft} value={ft}>{FEE_TYPE_LABELS[ft]}</option>)}
                      </select>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </Card>
      )}

      {result && sheet && (
        <Card title="3. Check and import">
          {result.errors.length > 0 && (
            <div className="mb-3"><Notice tone="warn">
              {result.errors.length} row{result.errors.length > 1 ? 's' : ''} can&apos;t be imported:{' '}
              {result.errors.slice(0, 5).map((e) => `row ${e.rowNumber}: ${e.message}`).join('; ')}
              {result.errors.length > 5 ? '…' : ''}
            </Notice></div>
          )}
          <div className="grid gap-3 md:grid-cols-5 text-sm mb-4">
            <div><div className="text-gray-500">Lines</div><div className="font-semibold">{result.lines.length}{result.skipped ? ` (${result.skipped} skipped)` : ''}</div></div>
            <div><div className="text-gray-500">Total ex GST</div><div className="font-semibold tabular-nums">{fmtMoney(totalEx)}</div></div>
            <div><div className="text-gray-500">Total incl GST</div><div className="font-semibold tabular-nums">{fmtMoney(totalEx + totalGst)}</div></div>
            <div><div className="text-gray-500">Matched to households</div><div className="font-semibold">{matchedCount} of {result.lines.length}</div></div>
            <div><div className="text-gray-500">Fee type to review</div><div className="font-semibold">{unclassifiedCount}</div></div>
          </div>
          {depositCents !== null && depositCents !== totalEx + totalGst && (
            <div className="mb-3"><Notice tone="warn">
              The bank deposit ({fmtMoney(depositCents)}) differs from the statement total incl. GST by {fmtMoney(depositCents - totalEx - totalGst)}.
            </Notice></div>
          )}
          {generationMonth && (
            <p className="text-sm text-gray-600 mb-3">
              Counted as received on <strong>{dateLabel(receivedDate)}</strong> and generated in <strong>{monthLabel(generationMonth)}</strong>
              {mapping.columns.period ? ' (or the month in the period column, where given)' : ''}.
            </p>
          )}
          <div className="overflow-x-auto border border-gray-200 rounded max-h-[28rem]">
            <table className="min-w-full">
              <thead className="sticky top-0">
                <tr>
                  <th className={thCls}>Row</th>
                  <th className={thCls}>Client</th>
                  <th className={thCls}>Reference</th>
                  <th className={thCls}>Fee type</th>
                  <th className={thCls}>Household</th>
                  <th className={thCls}>Adviser</th>
                  <th className={thNumCls}>Ex GST</th>
                  <th className={thNumCls}>GST</th>
                </tr>
              </thead>
              <tbody>
                {result.lines.slice(0, 200).map((l, i) => {
                  const m = matches[i]
                  return (
                    <tr key={l.rowNumber} className={i % 2 ? 'bg-row' : 'bg-white'}>
                      <td className={tdCls}>{l.rowNumber}</td>
                      <td className={tdCls}>{l.clientName || '—'}</td>
                      <td className={tdCls}>{l.reference || '—'}</td>
                      <td className={tdCls}>{l.feeType ? FEE_TYPE_LABELS[l.feeType] : <Badge tone="warn">review</Badge>}{l.rawFeeType && <div className="text-xs text-gray-500">{l.rawFeeType}</div>}</td>
                      <td className={tdCls}>
                        {m?.householdId ? households.get(m.householdId)?.name
                          : m?.suggestionId ? <span className="text-gray-500">Suggest: {households.get(m.suggestionId)?.name}</span>
                          : <Badge tone="warn">unmatched</Badge>}
                      </td>
                      <td className={tdCls}>
                        {(() => {
                          const adv = lineAdviser(l) ?? (m?.householdId ? households.get(m.householdId)?.adviser_id : null)
                          const name = adv ? lookups.advisers.find((x) => x.id === adv)?.name : null
                          return name ? <>{name}{!lineAdviser(l) && <span className="text-xs text-gray-500"> (household)</span>}</> : <Badge tone="warn">none</Badge>
                        })()}
                      </td>
                      <td className={tdNumCls}>{fmtMoney(l.amountCents)}</td>
                      <td className={tdNumCls}>{fmtMoney(l.gstCents)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {result.lines.length > 200 && <p className="text-xs text-gray-500 mt-1">Showing the first 200 lines.</p>}
          <div className="flex justify-end gap-2 mt-4">
            <Button disabled={!canImport} onClick={save}>{saving ? 'Importing…' : `Import ${result.lines.length} lines`}</Button>
          </div>
          <p className="text-xs text-gray-500 mt-2 text-right">Unmatched lines and fee types can be fixed on the statement after import.</p>
        </Card>
      )}
    </div>
  )
}

export default function UploadStatementPage() {
  return (
    <Suspense fallback={<Loading />}>
      <UploadStatement />
    </Suspense>
  )
}
