import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Column } from '../core/columns.js'
import { createTable, type Table, type TableOptions } from '../core/table.js'

/**
 * Create a table you can control from code: `const table = useDataTable({ data, columns })`,
 * then `<DataTable table={table} />`.
 *
 * A new `data` array is merged in with `table.syncData`: unsaved edits are kept, other
 * values update, and an edited cell whose source value also changed becomes a conflict.
 * Use `table.setData` to replace everything instead.
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
    if (options.data !== seen.current.data && !sameRows(options.data, seen.current.data)) table.syncData(options.data)
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

/**
 * A comparable description of the column definitions. Functions are compared by name
 * (their latest versions are always used), and React elements (header actions) by their
 * type and props, skipping React's internal back-references.
 */
function columnSignature(columns: readonly Column<any>[]) {
  return JSON.stringify(columns, (key, value) => {
    if (typeof value === 'function') return `fn:${value.name}`
    if (key.startsWith('_')) return undefined
    if (value && typeof value === 'object' && '$$typeof' in value) {
      const type = (value as { type: unknown }).type
      return { element: typeof type === 'string' ? type : (type as { name?: string })?.name, props: (value as { props: unknown }).props }
    }
    return value
  })
}
