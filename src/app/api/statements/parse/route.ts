import { NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { createServerSupabaseClient } from '@/lib/supabase'
import { parseCsv } from '@/lib/import/csv'
import { normaliseExcelValue, type Cell, type ParsedSheet } from '@/lib/import/cells'

const MAX_BYTES = 10 * 1024 * 1024
const MAX_ROWS = 20000

/**
 * Parse an uploaded commission statement into rows of cells. Nothing is
 * stored here — the browser maps the columns, previews, and only then saves
 * the statement (and its original file) under the user's own session.
 */
export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'File is larger than 10 MB' }, { status: 413 })

  const name = file.name.toLowerCase()
  try {
    let sheets: ParsedSheet[]
    if (name.endsWith('.csv') || name.endsWith('.txt')) {
      const rows = parseCsv(await file.text()).map((r) => r.map((c): Cell => c.trim() || null))
      sheets = [{ name: 'CSV', rows: rows.slice(0, MAX_ROWS) }]
    } else if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) {
      const wb = new ExcelJS.Workbook()
      await wb.xlsx.load(await file.arrayBuffer())
      sheets = wb.worksheets.map((ws) => {
        const rows: Cell[][] = []
        const width = ws.actualColumnCount || ws.columnCount
        ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
          if (rowNumber > MAX_ROWS) return
          const cells: Cell[] = []
          for (let c = 1; c <= width; c++) cells.push(normaliseExcelValue(row.getCell(c).value))
          rows[rowNumber - 1] = cells
        })
        // eachRow skips trailing gaps; fill holes so row index = sheet row - 1.
        for (let i = 0; i < rows.length; i++) rows[i] ??= []
        return { name: ws.name, rows }
      }).filter((s) => s.rows.length > 0)
    } else if (name.endsWith('.xls')) {
      return NextResponse.json(
        { error: 'Old-style .xls files aren\'t supported yet — open it in Excel and save as .xlsx or .csv.' },
        { status: 415 }
      )
    } else {
      return NextResponse.json({ error: 'Upload an Excel (.xlsx) or CSV file' }, { status: 415 })
    }
    if (!sheets.length) return NextResponse.json({ error: 'The file has no data' }, { status: 400 })
    return NextResponse.json({ sheets })
  } catch {
    return NextResponse.json({ error: 'Could not read that file — is it a valid spreadsheet?' }, { status: 400 })
  }
}
