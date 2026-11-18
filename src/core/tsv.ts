/** Tab-separated text as written and read by Excel, Google Sheets and Airtable. */

export function serializeTsv(matrix: readonly (readonly string[])[]): string {
  return matrix.map(row => row.map(quoteCell).join('\t')).join('\n')
}

function quoteCell(text: string) {
  return /[\t\n\r"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function parseTsv(text: string): string[][] {
  // Spreadsheets append one trailing newline to a copied range.
  const input = text.replace(/\r\n?/g, '\n').replace(/\n$/, '')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let index = 0
  let atCellStart = true
  while (index < input.length) {
    const char = input[index]!
    if (atCellStart && char === '"') {
      // Quoted cell: runs to the closing quote; "" is an escaped quote.
      let end = index + 1
      let value = ''
      let closed = false
      while (end < input.length) {
        if (input[end] === '"') {
          if (input[end + 1] === '"') { value += '"'; end += 2; continue }
          closed = true
          break
        }
        value += input[end]
        end++
      }
      const next = input[end + 1]
      if (closed && (next === undefined || next === '\t' || next === '\n')) {
        cell = value
        index = end + 1
        atCellStart = false
        continue
      }
      // Not a well-formed quoted cell: read it literally.
    }
    atCellStart = false
    if (char === '\t') { row.push(cell); cell = ''; atCellStart = true }
    else if (char === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; atCellStart = true }
    else cell += char
    index++
  }
  row.push(cell)
  rows.push(row)
  return rows
}
