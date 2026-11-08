import JSZip from 'jszip'

const WORKSHEET_REL = /\/relationships\/worksheet$/
const CANONICAL = /^sheet\d+\.xml$/

/**
 * exceljs only recognises worksheets stored as `xl/worksheets/sheetN.xml`
 * (lower-case, numbered) and silently returns a workbook with NO sheets
 * otherwise. Some providers' report generators (Australian Unity, Generation
 * Life) write `xl/worksheets/Sheet1.xml`, which Excel itself opens fine.
 *
 * Rename any worksheet part that isn't in exceljs's form to `sheetN.xml` and
 * fix every reference to it (workbook rels, content types, the sheet's own
 * rels file). Returns the input unchanged when nothing needs renaming.
 */
export async function normaliseXlsx(input: ArrayBuffer): Promise<ArrayBuffer> {
  const zip = await JSZip.loadAsync(input)
  const relsPath = 'xl/_rels/workbook.xml.rels'
  const rels = await zip.file(relsPath)?.async('string')
  if (!rels) return input

  const targets: string[] = []
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const type = m[0].match(/\bType="([^"]+)"/)?.[1] ?? ''
    const target = m[0].match(/\bTarget="([^"]+)"/)?.[1]
    if (target && WORKSHEET_REL.test(type)) targets.push(target)
  }
  // Target is relative to xl/ (or absolute from the package root).
  const partOf = (t: string) => (t.startsWith('/') ? t.slice(1) : `xl/${t}`)
  const bad = targets.filter((t) => !CANONICAL.test(t.split('/').pop() ?? '') || !partOf(t).startsWith('xl/worksheets/'))
  if (!bad.length) return input

  const taken = new Set(
    targets.filter((t) => !bad.includes(t)).map((t) => Number(t.match(/sheet(\d+)\.xml$/)![1]))
  )
  const renames = new Map<string, string>() // old part path → new part path
  for (const t of bad) {
    const digits = Number(t.match(/(\d+)\.xml$/i)?.[1] ?? NaN)
    let n = Number.isInteger(digits) && digits > 0 && !taken.has(digits) ? digits : 1
    while (taken.has(n)) n++
    taken.add(n)
    renames.set(partOf(t), `xl/worksheets/sheet${n}.xml`)
  }

  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  let newRels = rels
  let types = (await zip.file('[Content_Types].xml')?.async('string')) ?? null
  for (const [from, to] of renames) {
    const file = zip.file(from)
    if (!file) continue
    zip.file(to, await file.async('uint8array'))
    zip.remove(from)
    const fromName = from.split('/').pop()!
    const toName = to.split('/').pop()!
    const sheetRels = zip.file(`xl/worksheets/_rels/${fromName}.rels`)
    if (sheetRels) {
      zip.file(`xl/worksheets/_rels/${toName}.rels`, await sheetRels.async('uint8array'))
      zip.remove(`xl/worksheets/_rels/${fromName}.rels`)
    }
    newRels = newRels.replace(
      new RegExp(`Target="(/?)(xl/)?${escapeRe(from.slice(3))}"`, 'g'),
      (_m, slash: string, xl: string | undefined) => `Target="${slash}${xl ?? ''}${to.slice(3)}"`
    )
    if (types) types = types.split(`PartName="/${from}"`).join(`PartName="/${to}"`)
  }
  zip.file(relsPath, newRels)
  if (types !== null) zip.file('[Content_Types].xml', types)
  return zip.generateAsync({ type: 'arraybuffer' })
}
