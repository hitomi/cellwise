import { describe, expect, it } from 'vitest'
import { parseTsv, serializeTsv } from './tsv.js'

describe('tsv', () => {
  it('round-trips tabs, newlines and quotes', () => {
    const matrix = [['a', 'b\tc', 'line 1\nline 2'], ['say "hi"', '', 'x']]
    expect(parseTsv(serializeTsv(matrix))).toEqual(matrix)
  })

  it('reads spreadsheet output with CRLF and a trailing newline', () => {
    expect(parseTsv('a\tb\r\nc\td\r\n')).toEqual([['a', 'b'], ['c', 'd']])
  })

  it('reads a stray quote literally', () => {
    expect(parseTsv('5" screen\tok')).toEqual([['5" screen', 'ok']])
    expect(parseTsv('"unclosed\tx')).toEqual([['"unclosed', 'x']])
  })

  it('keeps empty cells', () => {
    expect(parseTsv('\t\n\t')).toEqual([['', ''], ['', '']])
  })
})
