import { describe, it, expect } from 'vitest'
import { centsCol, toCsv } from '../csv-export'

describe('toCsv', () => {
  it('quotes, escapes and neutralises formulas', () => {
    expect(toCsv([['a', 'b,c', 'say "hi"'], [1, null, '=HYPERLINK("x")'], ['-12.50', '@sum', '']])).toBe(
      '﻿a,"b,c","say ""hi"""\r\n1,,"\'=HYPERLINK(""x"")"\r\n-12.50,\'@sum,'
    )
  })
  it('formats cents', () => {
    expect(centsCol(-123456)).toBe('-1234.56')
  })
})
