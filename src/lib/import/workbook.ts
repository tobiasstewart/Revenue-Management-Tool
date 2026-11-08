import ExcelJS from 'exceljs'
import { parseCsv } from './csv'
import { normaliseExcelValue, type Cell, type ParsedSheet } from './cells'
import { normaliseXlsx } from './xlsx-normalise'

export const MAX_ROWS = 20000

/** CSV text → one sheet of trimmed cells (blank → null). */
export function parseCsvSheet(text: string): ParsedSheet {
  const rows = parseCsv(text).map((r) => r.map((c): Cell => c.trim() || null))
  return { name: 'CSV', rows: rows.slice(0, MAX_ROWS) }
}

/** .xlsx / .xlsm bytes → sheets of cells, row index = sheet row − 1. */
export async function parseXlsx(buf: ArrayBuffer): Promise<ParsedSheet[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await normaliseXlsx(buf))
  return wb.worksheets
    .map((ws) => {
      const rows: Cell[][] = []
      // Width from the cells actually present: exceljs's actualColumnCount
      // undercounts some generated workbooks (Generation Life: data to column
      // O reported as 9 columns), which silently drops the amount columns.
      let width = 0
      ws.eachRow({ includeEmpty: false }, (row) => {
        width = Math.max(width, row.cellCount)
      })
      ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
        if (rowNumber > MAX_ROWS) return
        const cells: Cell[] = []
        for (let c = 1; c <= width; c++) cells.push(normaliseExcelValue(row.getCell(c).value))
        rows[rowNumber - 1] = cells
      })
      // eachRow skips trailing gaps; fill holes so row index = sheet row - 1.
      for (let i = 0; i < rows.length; i++) rows[i] ??= []
      return { name: ws.name, rows }
    })
    .filter((s) => s.rows.length > 0)
}
