import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Column } from '../core/columns.js'
import { createTable, type Table, type TableOptions } from '../core/table.js'

/**
 * Create a table you can control from code: `const table = useDataTable({ data, columns })`,
 * then `<DataTable table={table} />`.
 *
 * Passing a different `data` array replaces the data (and clears unsaved changes),
 * so keep it stable, e.g. from state or a data-fetching library.
 */
export function useDataTable<Row>(options: TableOptions<Row>): Table<Row> {
  const [table] = useState(() => createTable(options))
  const seen = useRef({ data: options.data, columns: columnSignature(options.columns) })

  useLayoutEffect(() => {
    table.configure(options)
    const signature = columnSignature(options.columns)
    // Inline column arrays are new on every render: only re-render when their shape changes.
    table.setColumns(options.columns, signature !== seen.current.columns)
    seen.current.columns = signature
    if (options.data !== seen.current.data && !sameRows(options.data, seen.current.data)) table.setData(options.data)
    seen.current.data = options.data
  })

  return table
}

/** Re-render when the table changes. */
export function useTableVersion(table: Table<any>) {
  return useSyncExternalStore(table.subscribe, table.getVersion, table.getVersion)
}

function sameRows(a: readonly unknown[], b: readonly unknown[]) {
  return a.length === b.length && a.every((row, index) => row === b[index])
}

function columnSignature(columns: readonly Column<any>[]) {
  return JSON.stringify(columns, (_key, value) => typeof value === 'function' ? `fn:${value.name}` : value)
}
