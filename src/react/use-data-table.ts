import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Column } from '../core/columns.js'
import { createTable, type DraftRestore, type Table, type TableDraft, type TableOptions } from '../core/table.js'

export interface DraftOptions {
  /** Storage key, unique per table and user, e.g. `products:${userId}`. */
  key: string
  /** The data is loaded, so the draft can be applied. Default: once `data` has rows. */
  ready?: boolean
  /** Where drafts are kept. Default `localStorage`. */
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  /** Write this many ms after the last change. Default 500. */
  delay?: number
  /** Drafts older than this (ms) are dropped. Default 7 days. */
  maxAge?: number
  /** Called after a stored draft was applied, e.g. to tell the user. */
  onRestore?: (result: DraftRestore) => void
}

export interface UseDataTableOptions<Row> extends TableOptions<Row> {
  /** Keep unsaved changes in local storage and restore them after a reload. */
  draft?: DraftOptions
}

/**
 * Create a table you can control from code: `const table = useDataTable({ data, columns })`,
 * then `<DataTable table={table} />`.
 *
 * A new `data` array is merged in with `table.syncData`: unsaved edits are kept, other
 * values update, and an edited cell whose source value also changed becomes a conflict.
 * Use `table.setData` to replace everything instead.
 */
export function useDataTable<Row>(options: UseDataTableOptions<Row>): Table<Row> {
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
  const { draft } = options
  useTableDraft(table, draft && { ...draft, ready: draft.ready ?? options.data.length > 0 })

  return table
}

const DAY = 24 * 60 * 60 * 1000

/**
 * Keep the table's unsaved changes in local storage while it is open, and apply them again
 * once the data is loaded (see `table.restoreDraft`). A save, or discarding changes,
 * clears the stored draft. `useDataTable({ draft })` calls this for you.
 */
export function useTableDraft<Row>(table: Table<Row>, options: DraftOptions | undefined) {
  const restored = useRef<string | null>(null)
  const onRestore = useRef(options?.onRestore)
  onRestore.current = options?.onRestore
  const key = options?.key
  const ready = options?.ready ?? true
  const delay = options?.delay ?? 500
  const maxAge = options?.maxAge ?? 7 * DAY
  const storage = options?.storage

  useEffect(() => {
    if (key === undefined || !ready) return
    const store = storage ?? defaultStorage()
    if (!store) return
    if (restored.current !== key) {
      restored.current = key
      const stored = readDraft(store, key, maxAge)
      if (stored) onRestore.current?.(table.restoreDraft(stored))
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const write = () => {
      clearTimeout(timer)
      timer = undefined
      const draft = table.getDraft()
      try {
        if (draft) store.setItem(key, JSON.stringify({ savedAt: Date.now(), draft }))
        else store.removeItem(key)
      } catch { /* storage full or blocked: drafts are a convenience */ }
    }
    const unsubscribe = table.subscribe(() => {
      clearTimeout(timer)
      timer = setTimeout(write, delay)
    })
    // Closing the tab or leaving the page must not lose the last edits.
    window.addEventListener('pagehide', write)
    return () => {
      unsubscribe()
      window.removeEventListener('pagehide', write)
      if (timer !== undefined) write()
    }
  }, [table, key, ready, delay, maxAge, storage])
}

function defaultStorage() {
  try { return typeof window === 'undefined' ? undefined : window.localStorage } catch { return undefined }
}

function readDraft(store: NonNullable<DraftOptions['storage']>, key: string, maxAge: number): TableDraft | null {
  try {
    const raw = store.getItem(key)
    if (!raw) return null
    const { savedAt, draft } = JSON.parse(raw) as { savedAt?: number; draft?: TableDraft }
    if (!draft || draft.version !== 1 || typeof savedAt !== 'number' || Date.now() - savedAt > maxAge) {
      store.removeItem(key)
      return null
    }
    return draft
  } catch {
    return null
  }
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
