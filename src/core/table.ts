import { resolveColumn, type Column, type FieldKey, type ResolvedColumn, type RowId } from './columns.js'
import { isParseError } from './field-type.js'
import { parseTsv, serializeTsv } from './tsv.js'

/** Stable internal row key. Equals the row id for loaded rows; new rows get a temporary key. */
export type RowKey = RowId

/** Inclusive cell range in view coordinates (visible row index, column index). */
export interface CellRange {
  rowStart: number
  rowEnd: number
  colStart: number
  colEnd: number
}

/** One range, or several (a multi-range selection). */
export type CellTarget = CellRange | readonly CellRange[]

/** One column's change in a bulk edit: an operation from the field type's `bulk` map. */
export interface BulkEdit {
  field: string
  operation: string
  args?: Record<string, unknown>
}

export interface BulkPlan {
  /** Cells whose value will change. */
  changes: number
  /** Cells left as they are because the operation gives the same value. */
  unchanged: number
  /** Cells that cannot be changed, with the reason. */
  errors: CellError[]
}

export interface CellError {
  row: RowKey
  field: string
  message: string
}

export interface EditResult {
  /** Number of cells or rows changed. */
  applied: number
  /** Cells that were skipped, with the reason. */
  errors: CellError[]
}

export interface Filter {
  field: string
  /** Operator name from the field type's `filters`, e.g. `'contains'`, `'gt'`, `'isEmpty'`. */
  operator: string
  value?: unknown
}

export interface Sort {
  field: string
  direction: 'asc' | 'desc'
}

export interface TableChanges<Row> {
  created: Row[]
  updated: { id: RowId; row: Row; changed: FieldKey<Row>[] }[]
  deleted: RowId[]
}

export interface SaveError<Row> {
  /** Id of an updated or deleted row. */
  id?: RowId
  /** Index into `changes.created`. */
  created?: number
  field?: FieldKey<Row>
  message: string
}

export interface SaveResult<Row> {
  /** Server versions of the created rows, in `changes.created` order (e.g. with assigned ids). */
  created?: readonly (Row | undefined)[]
  /** Server versions of updated rows, matched by id. */
  updated?: readonly Row[]
  /** Rows the server did not save. They stay changed and show the message. */
  errors?: readonly SaveError<Row>[]
}

export type SaveHandler<Row> = (changes: TableChanges<Row>) => void | SaveResult<Row> | Promise<void | SaveResult<Row>>

export type SaveOutcome =
  | { status: 'saved'; errors: number }
  | { status: 'nothing-to-save' }
  | { status: 'invalid'; cells: number }
  | { status: 'failed'; error: string }

export interface TableOptions<Row> {
  data: readonly Row[]
  columns: readonly Column<Row>[]
  /** Field holding the row id, or a function returning it. Default `'id'`. */
  rowId?: FieldKey<Row> | ((row: Row) => RowId)
  /** Values for a new row. Default `{}`. */
  createRow?: () => Partial<Row>
  onSave?: SaveHandler<Row>
  /** Save automatically this many ms after the last edit. */
  autoSave?: number
  readOnly?: boolean
  /** Undo steps kept. Default 500. */
  historyLimit?: number
}

export interface TableStatus {
  canUndo: boolean
  canRedo: boolean
  /** Rows created, updated or deleted since the last save. */
  changedRows: number
  invalidCells: number
  saving: boolean
  saveError: string | undefined
}

export interface CellState {
  value: unknown
  changed: boolean
  error: string | undefined
}

type Entry<Row> = { key: RowKey; row: Row; at: number; viewAt: number }
type Op<Row> =
  | { t: 'set'; key: RowKey; field: string; before: unknown; after: unknown }
  | { t: 'insert' | 'delete'; entries: Entry<Row>[] }

export type Table<Row> = ReturnType<typeof createTable<Row>>

export function createTable<Row>(options: TableOptions<Row>) {
  type R = Row & Record<string, unknown>
  const idOption = options.rowId ?? 'id'
  const getId = typeof idOption === 'function' ? idOption : (row: Row) => (row as R)[idOption] as RowId
  const historyLimit = options.historyLimit ?? 500

  let onSave = options.onSave
  let autoSave = options.autoSave
  let readOnly = options.readOnly ?? false
  let createRowValues = options.createRow ?? (() => ({}))

  let columns: readonly ResolvedColumn<Row>[] = []
  let columnByField = new Map<string, ResolvedColumn<Row>>()

  // Data. `order` is the natural order; `view` the filtered and sorted keys.
  let rows = new Map<RowKey, Row>()
  let order: RowKey[] = []
  let view: RowKey[] = []
  let viewIndex: Map<RowKey, number> | null = null
  let baseline = new Map<RowKey, Row>()
  const created = new Set<RowKey>()
  const deleted = new Map<RowKey, Row>()
  const changed = new Map<RowKey, Set<string>>()
  const invalid = new Map<RowKey, Map<string, string>>()
  const saveErrors = new Map<RowKey, string>()
  const idAlias = new Map<RowId, RowKey>()
  let nextNewKey = 1

  let filters: readonly Filter[] = []
  let sort: readonly Sort[] = []
  let search = ''

  let undoStack: Op<Row>[][] = []
  let redoStack: Op<Row>[][] = []

  let saving: Promise<SaveOutcome> | null = null
  let saveQueued = false
  let saveError: string | undefined
  let autoSaveTimer: ReturnType<typeof setTimeout> | undefined

  let version = 0
  const listeners = new Set<() => void>()

  // ---- batching ---------------------------------------------------------

  /** Ops and per-row working copies of the change in progress. */
  let batch: { ops: Op<Row>[]; copies: Map<RowKey, R>; touched: Map<RowKey, Set<string> | 'all'> } | null = null

  function run<T>(record: 'history' | 'none', fn: () => T): T {
    if (batch) return fn()
    batch = { ops: [], copies: new Map(), touched: new Map() }
    const current = batch
    try {
      return fn()
    } finally {
      batch = null
      for (const [key, fields] of current.touched) refreshCells(key, fields)
      if (current.ops.length) {
        if (record === 'history') {
          undoStack.push(current.ops)
          if (undoStack.length > historyLimit) undoStack.shift()
          redoStack = []
        }
        scheduleAutoSave()
        emit()
      }
    }
  }

  function emit() {
    version++
    for (const listener of [...listeners]) listener()
  }

  function touch(key: RowKey, field: string | 'all') {
    const touched = batch!.touched
    const existing = touched.get(key)
    if (existing === 'all') return
    if (field === 'all') { touched.set(key, 'all'); return }
    if (existing) existing.add(field)
    else touched.set(key, new Set([field]))
  }

  function sameValue(column: ResolvedColumn<Row> | undefined, a: unknown, b: unknown) {
    if (!column) return Object.is(a, b)
    const emptyA = column.type.isEmpty(a), emptyB = column.type.isEmpty(b)
    if (emptyA || emptyB) return emptyA && emptyB
    return column.type.equals(a, b)
  }

  /** Write one cell inside the current batch. Returns false for a no-op. */
  function write(key: RowKey, field: string, value: unknown): boolean {
    const current = rows.get(key) as R | undefined
    if (!current) return false
    const before = current[field]
    if (sameValue(columnByField.get(field), before, value)) return false
    const { copies, ops } = batch!
    let copy = copies.get(key)
    if (!copy) {
      copy = { ...current }
      copies.set(key, copy)
      rows.set(key, copy)
    }
    ;(copy as Record<string, unknown>)[field] = value
    ops.push({ t: 'set', key, field, before, after: value })
    touch(key, field)
    return true
  }

  function insertEntries(entries: Entry<Row>[]) {
    if (!entries.length) return
    for (const entry of entries) {
      rows.set(entry.key, entry.row)
      if (baseline.has(entry.key)) deleted.delete(entry.key)
      else created.add(entry.key)
      touch(entry.key, 'all')
    }
    order = spliceIn(order, entries, entry => entry.at)
    view = spliceIn(view, entries, entry => entry.viewAt)
    viewIndex = null
    batch!.ops.push({ t: 'insert', entries })
  }

  function deleteKeys(keys: Iterable<RowKey>) {
    const remove = new Set<RowKey>()
    for (const key of keys) if (rows.has(key)) remove.add(key)
    if (!remove.size) return 0
    const entries: Entry<Row>[] = []
    const viewPositions = new Map<RowKey, number>()
    view.forEach((key, index) => { if (remove.has(key)) viewPositions.set(key, index) })
    order.forEach((key, index) => {
      if (remove.has(key)) entries.push({ key, row: rows.get(key)!, at: index, viewAt: viewPositions.get(key) ?? -1 })
    })
    for (const { key } of entries) {
      rows.delete(key)
      batch!.copies.delete(key)
      changed.delete(key)
      invalid.delete(key)
      saveErrors.delete(key)
      if (created.has(key)) created.delete(key)
      else deleted.set(key, baseline.get(key)!)
    }
    order = order.filter(key => !remove.has(key))
    view = view.filter(key => !remove.has(key))
    viewIndex = null
    batch!.ops.push({ t: 'delete', entries })
    return entries.length
  }

  /** Recompute changed and validation state for the touched cells of a row. */
  function refreshCells(key: RowKey, fields: Set<string> | 'all') {
    const row = rows.get(key)
    if (!row) return
    const base = baseline.get(key)
    const list = fields === 'all' ? columns.map(column => column.field) : fields
    for (const field of list) {
      const column = columnByField.get(field)
      if (base) setFlag(changed, key, field, !sameValue(column, (base as R)[field], (row as R)[field]))
      if (column) {
        const error = column.validate((row as R)[field] ?? null, row)
        const errors = invalid.get(key)
        if (error) {
          if (errors) errors.set(field, error)
          else invalid.set(key, new Map([[field, error]]))
        } else if (errors) {
          errors.delete(field)
          if (!errors.size) invalid.delete(key)
        }
      }
    }
  }

  function scheduleAutoSave() {
    if (autoSave === undefined || !onSave) return
    clearTimeout(autoSaveTimer)
    autoSaveTimer = setTimeout(() => { void save() }, autoSave)
  }

  // ---- data and columns ---------------------------------------------------

  /** Replace the column definitions. `notify: false` updates callbacks without re-rendering. */
  function setColumns(definitions: readonly Column<Row>[], notify = true) {
    const resolved = definitions.map(resolveColumn)
    const byField = new Map(resolved.map(column => [column.field, column]))
    if (byField.size !== resolved.length) throw new Error('Each column needs a unique field.')
    columns = resolved
    columnByField = byField
    if (notify) emit()
  }

  /** Replace all data: clears changes, history and errors. */
  function setData(data: readonly Row[]) {
    clearTimeout(autoSaveTimer)
    rows = new Map()
    order = new Array(data.length)
    data.forEach((row, index) => {
      const id = getId(row)
      if (typeof id !== 'string' && typeof id !== 'number')
        throw new Error(`Row ${index} has no id. Set the \`rowId\` option to the field that identifies rows.`)
      if (rows.has(id)) throw new Error(`Duplicate row id "${String(id)}" at row ${index}.`)
      rows.set(id, row)
      order[index] = id
    })
    baseline = new Map(rows)
    created.clear(); deleted.clear(); changed.clear(); invalid.clear(); saveErrors.clear(); idAlias.clear()
    undoStack = []
    redoStack = []
    saveError = undefined
    rebuildView()
    emit()
  }

  // ---- view ---------------------------------------------------------------

  function rebuildView() {
    let keys = order
    const active = filters.flatMap(filter => {
      const column = columnByField.get(filter.field)
      const operator = column?.type.filters[filter.operator]
      return column && operator ? [{ column, operator, value: filter.value }] : []
    })
    const query = search.trim().toLowerCase()
    if (active.length || query) {
      keys = keys.filter(key => {
        const row = rows.get(key) as R
        for (const { column, operator, value } of active) {
          const cell = row[column.field]
          if (!operator.test(column.type.isEmpty(cell) ? null : cell, value, column.options)) return false
        }
        return !query || columns.some(column => {
          const cell = row[column.field]
          return !column.type.isEmpty(cell) && column.type.format(cell, column.options).toLowerCase().includes(query)
        })
      })
    }
    const sorts = sort.flatMap(entry => {
      const column = columnByField.get(entry.field)
      return column ? [{ column, sign: entry.direction === 'desc' ? -1 : 1 }] : []
    })
    if (sorts.length) {
      // Read each sort value once, then sort positions. Empty cells sort last in both directions.
      const values = sorts.map(({ column }) => keys.map(key => {
        const cell = (rows.get(key) as R)[column.field]
        return column.type.isEmpty(cell) ? null : cell
      }))
      const positions = keys.map((_, index) => index)
      positions.sort((a, b) => {
        for (let level = 0; level < sorts.length; level++) {
          const { column, sign } = sorts[level]!
          const x = values[level]![a], y = values[level]![b]
          if (x === null || y === null) {
            if (x !== y) return x === null ? 1 : -1
            continue
          }
          const result = column.type.compare(x, y, column.options)
          if (result) return result * sign
        }
        return a - b
      })
      keys = positions.map(index => keys[index]!)
    }
    view = keys === order ? [...order] : keys
    viewIndex = null
  }

  function setView(next: { filters?: readonly Filter[]; sort?: readonly Sort[]; search?: string }) {
    if (next.filters) filters = next.filters
    if (next.sort) sort = next.sort
    if (next.search !== undefined) search = next.search
    rebuildView()
    emit()
  }

  function viewPosition(key: RowKey) {
    if (!viewIndex) viewIndex = new Map(view.map((entry, index) => [entry, index]))
    return viewIndex.get(key)
  }

  // ---- edits --------------------------------------------------------------

  function editable(key: RowKey, field: string): string | undefined {
    if (readOnly) return 'The table is read-only'
    const column = columnByField.get(field)
    const row = rows.get(key)
    if (!column) return `Unknown column "${field}"`
    if (!row) return 'Row not found'
    if (column.isReadOnly(row)) return 'Read-only'
    return undefined
  }

  /** Parse text with the column's type. */
  function parseCell(field: string, text: string): { value: unknown } | { error: string } {
    const column = columnByField.get(field)
    if (!column) return { error: `Unknown column "${field}"` }
    const result = column.type.parse(text, column.options)
    return isParseError(result) ? result : { value: result }
  }

  function setCell(key: RowKey, field: string, value: unknown): EditResult {
    const reason = editable(key, field)
    if (reason) return { applied: 0, errors: [{ row: key, field, message: reason }] }
    return run('history', () => ({ applied: write(key, field, value) ? 1 : 0, errors: [] }))
  }

  function setCellText(key: RowKey, field: string, text: string): EditResult {
    const parsed = parseCell(field, text)
    if ('error' in parsed) return { applied: 0, errors: [{ row: key, field, message: parsed.error }] }
    return setCell(key, field, parsed.value)
  }

  /** Several cell writes as one undo step. */
  function setCells(updates: readonly { row: RowKey; field: string; value: unknown }[]): EditResult {
    const errors: CellError[] = []
    let applied = 0
    run('history', () => {
      for (const update of updates) {
        const reason = editable(update.row, update.field)
        if (reason) errors.push({ row: update.row, field: update.field, message: reason })
        else if (write(update.row, update.field, update.value)) applied++
      }
    })
    return { applied, errors }
  }

  function clampRange(range: CellRange): CellRange | null {
    const rowStart = Math.max(0, Math.min(range.rowStart, range.rowEnd))
    const rowEnd = Math.min(view.length - 1, Math.max(range.rowStart, range.rowEnd))
    const colStart = Math.max(0, Math.min(range.colStart, range.colEnd))
    const colEnd = Math.min(columns.length - 1, Math.max(range.colStart, range.colEnd))
    return rowStart > rowEnd || colStart > colEnd ? null : { rowStart, rowEnd, colStart, colEnd }
  }

  function rangesOf(target: CellTarget): CellRange[] {
    const list = Array.isArray(target) ? target as readonly CellRange[] : [target as CellRange]
    return list.flatMap(range => clampRange(range) ?? [])
  }

  /** Visit each selected cell once, even where ranges overlap. */
  function forEachCell(target: CellTarget, visit: (key: RowKey, column: ResolvedColumn<Row>, r: number, c: number) => void) {
    const ranges = rangesOf(target)
    ranges.forEach((range, index) => {
      for (let r = range.rowStart; r <= range.rowEnd; r++) {
        for (let c = range.colStart; c <= range.colEnd; c++) {
          let seen = false
          for (let earlier = 0; earlier < index && !seen; earlier++) {
            const other = ranges[earlier]!
            seen = r >= other.rowStart && r <= other.rowEnd && c >= other.colStart && c <= other.colEnd
          }
          if (!seen) visit(view[r]!, columns[c]!, r, c)
        }
      }
    })
  }

  function formatCell(column: ResolvedColumn<Row>, value: unknown) {
    return column.type.isEmpty(value) ? '' : column.type.format(value, column.options)
  }

  function matrixOf(bounds: CellRange): string[][] {
    const matrix: string[][] = []
    for (let r = bounds.rowStart; r <= bounds.rowEnd; r++) {
      const row = rows.get(view[r]!) as R
      const line: string[] = []
      for (let c = bounds.colStart; c <= bounds.colEnd; c++) line.push(formatCell(columns[c]!, row[columns[c]!.field]))
      matrix.push(line)
    }
    return matrix
  }

  /**
   * Cells as tab-separated text, ready for the clipboard. Several ranges are joined
   * side by side when they cover the same rows, or stacked when they cover the same
   * columns (like Excel); otherwise only the last range is copied.
   */
  function copy(target: CellTarget): string {
    const ranges = rangesOf(target)
    if (!ranges.length) return ''
    const sameRows = ranges.every(range => range.rowStart === ranges[0]!.rowStart && range.rowEnd === ranges[0]!.rowEnd)
    const sameColumns = ranges.every(range => range.colStart === ranges[0]!.colStart && range.colEnd === ranges[0]!.colEnd)
    if (ranges.length > 1 && sameRows) {
      const sorted = [...ranges].sort((a, b) => a.colStart - b.colStart)
      const parts = sorted.map(matrixOf)
      return serializeTsv(parts[0]!.map((_, index) => parts.flatMap(part => part[index]!)))
    }
    if (ranges.length > 1 && sameColumns) return serializeTsv([...ranges].sort((a, b) => a.rowStart - b.rowStart).flatMap(matrixOf))
    return serializeTsv(matrixOf(ranges[ranges.length - 1]!))
  }

  /** Whether `copy` can include every range of the target. */
  function canCopyAll(target: CellTarget): boolean {
    const ranges = rangesOf(target)
    return ranges.length <= 1
      || ranges.every(range => range.rowStart === ranges[0]!.rowStart && range.rowEnd === ranges[0]!.rowEnd)
      || ranges.every(range => range.colStart === ranges[0]!.colStart && range.colEnd === ranges[0]!.colEnd)
  }

  /**
   * Paste tab-separated text at the range. A block pasted into a larger range
   * that is an exact multiple of it is repeated to fill the range; otherwise it
   * is pasted from the top-left cell, adding rows past the end of the view.
   */
  function paste(target: CellTarget, text: string): EditResult {
    if (!Array.isArray(target)) return pasteInto(target as CellRange, text)
    // Paste into each range; one undo step.
    const result: EditResult = { applied: 0, errors: [] }
    run('history', () => {
      for (const range of target as readonly CellRange[]) {
        const part = pasteInto(range, text)
        result.applied += part.applied
        result.errors.push(...part.errors)
      }
    })
    return result
  }

  function pasteInto(range: CellRange, text: string): EditResult {
    const matrix = parseTsv(text)
    const height = matrix.length
    const width = Math.max(...matrix.map(line => line.length))
    const target = { ...range, rowStart: Math.min(range.rowStart, range.rowEnd), colStart: Math.min(range.colStart, range.colEnd) }
    const rangeHeight = Math.abs(range.rowEnd - range.rowStart) + 1
    const rangeWidth = Math.abs(range.colEnd - range.colStart) + 1
    const tile = rangeHeight % height === 0 && rangeWidth % width === 0
    const rowCount = tile ? rangeHeight : height
    const colCount = Math.min(tile ? rangeWidth : width, columns.length - target.colStart)
    const errors: CellError[] = []
    let applied = 0
    run('history', () => {
      const newRows: Entry<Row>[] = []
      for (let r = 0; r < rowCount; r++) {
        const position = target.rowStart + r
        const line = matrix[r % height]!
        const key = view[position]
        if (key === undefined) {
          if (readOnly) break
          // Past the last row: build the new row with its pasted values before inserting it.
          const newKey = `new:${nextNewKey++}`
          const row = { ...createRowValues() } as R
          for (let c = 0; c < colCount; c++) {
            const column = columns[target.colStart + c]!
            const parsed = parseCell(column.field, line[c % width] ?? '')
            if ('error' in parsed) errors.push({ row: newKey, field: column.field, message: parsed.error })
            else if (!column.type.isEmpty(parsed.value)) (row as Record<string, unknown>)[column.field] = parsed.value
          }
          newRows.push({ key: newKey, row, at: order.length + newRows.length, viewAt: view.length + newRows.length })
          applied++
          continue
        }
        for (let c = 0; c < colCount; c++) {
          const field = columns[target.colStart + c]!.field
          const reason = editable(key, field)
          if (reason) { errors.push({ row: key, field, message: reason }); continue }
          const parsed = parseCell(field, line[c % width] ?? '')
          if ('error' in parsed) errors.push({ row: key, field, message: parsed.error })
          else if (write(key, field, parsed.value)) applied++
        }
      }
      insertEntries(newRows)
    })
    return { applied, errors }
  }

  /** Empty every editable cell. Read-only cells are skipped silently. */
  function clear(target: CellTarget): EditResult {
    if (readOnly) return { applied: 0, errors: [{ row: view[0]!, field: columns[0]?.field ?? '', message: 'The table is read-only' }] }
    let applied = 0
    run('history', () => forEachCell(target, (key, column) => {
      if (!editable(key, column.field) && write(key, column.field, null)) applied++
    }))
    return { applied, errors: [] }
  }

  /**
   * Write one value to every selected cell, as one undo step. `fromField` is the
   * column the value came from; other columns receive it converted through text.
   */
  function setValue(target: CellTarget, value: unknown, fromField: string): EditResult {
    const source = columnByField.get(fromField)
    if (!source) return { applied: 0, errors: [] }
    const text = formatCell(source, value)
    const converted = new Map<ResolvedColumn<Row>, { value: unknown } | { error: string }>()
    const errors: CellError[] = []
    let applied = 0
    run('history', () => forEachCell(target, (key, column) => {
      const reason = editable(key, column.field)
      if (reason) { errors.push({ row: key, field: column.field, message: reason }); return }
      let next = converted.get(column)
      if (!next) {
        next = column === source || (column.type === source.type && sameOptions(column, source)) ? { value } : parseCell(column.field, text)
        converted.set(column, next)
      }
      if ('error' in next) errors.push({ row: key, field: column.field, message: next.error })
      else if (write(key, column.field, next.value)) applied++
    }))
    return { applied, errors }
  }

  type CellUpdate = (value: unknown, column: ResolvedColumn<Row>) => unknown

  function bulkPlan(target: CellTarget, edits: readonly BulkEdit[]) {
    const byField = new Map<string, CellUpdate>()
    for (const edit of edits) {
      const operation = columnByField.get(edit.field)?.type.bulk[edit.operation]
      byField.set(edit.field, operation
        ? (value, column) => operation.apply(value, edit.args ?? {}, column.options)
        : () => ({ error: `Unknown operation "${edit.operation}"` }))
    }
    return updatePlan(target, byField)
  }

  /** Plan new values for the selected cells of the given columns. */
  function updatePlan(target: CellTarget, byField: Map<string, CellUpdate>) {
    const updates: { key: RowKey; field: string; value: unknown }[] = []
    const errors: CellError[] = []
    let unchanged = 0
    forEachCell(target, (key, column) => {
      const update = byField.get(column.field)
      if (!update) return
      const reason = editable(key, column.field)
      if (reason) { errors.push({ row: key, field: column.field, message: reason }); return }
      const current = (rows.get(key) as R)[column.field]
      let next: unknown
      try {
        next = update(column.type.isEmpty(current) ? null : current, column)
      } catch (error) {
        next = { error: error instanceof Error ? error.message : String(error) }
      }
      if (isParseError(next)) errors.push({ row: key, field: column.field, message: next.error })
      else if (sameValue(column, current, next)) unchanged++
      else updates.push({ key, field: column.field, value: next })
    })
    return { updates, errors, unchanged }
  }

  /** What `bulkEdit` would do, without changing anything. */
  function previewBulkEdit(target: CellTarget, edits: readonly BulkEdit[]): BulkPlan {
    const plan = bulkPlan(target, edits)
    return { changes: plan.updates.length, unchanged: plan.unchanged, errors: plan.errors }
  }

  /** Apply per-column bulk operations to the selected cells, as one undo step. */
  function bulkEdit(target: CellTarget, edits: readonly BulkEdit[]): EditResult {
    return applyPlan(bulkPlan(target, edits))
  }

  /**
   * Compute a new value for each selected cell of one column, as one undo step.
   * Return `{ error }` to skip a cell. Read-only cells are skipped.
   */
  function updateCells(target: CellTarget, field: string, update: (value: any) => unknown): EditResult {
    return applyPlan(updatePlan(target, new Map([[field, value => update(value)]])))
  }

  function applyPlan(plan: ReturnType<typeof updatePlan>): EditResult {
    let applied = 0
    run('history', () => { for (const update of plan.updates) if (write(update.key, update.field, update.value)) applied++ })
    return { applied, errors: plan.errors }
  }

  /** Drag-fill: repeat the `source` block across `target`, which contains it. */
  function fill(source: CellRange, target: CellRange): EditResult {
    const from = clampRange(source), to = clampRange(target)
    if (!from || !to) return { applied: 0, errors: [] }
    const height = from.rowEnd - from.rowStart + 1, width = from.colEnd - from.colStart + 1
    const updates: { row: RowKey; field: string; value: unknown }[] = []
    const errors: CellError[] = []
    for (let r = to.rowStart; r <= to.rowEnd; r++) {
      for (let c = to.colStart; c <= to.colEnd; c++) {
        if (r >= from.rowStart && r <= from.rowEnd && c >= from.colStart && c <= from.colEnd) continue
        const sourceRow = from.rowStart + mod(r - from.rowStart, height)
        const sourceColumn = columns[from.colStart + mod(c - from.colStart, width)]!
        const column = columns[c]!
        let value = (rows.get(view[sourceRow]!) as R)[sourceColumn.field]
        if (sourceColumn !== column) {
          // Across columns of different types, convert through text.
          const parsed = parseCell(column.field, formatCell(sourceColumn, value))
          if ('error' in parsed) { errors.push({ row: view[r]!, field: column.field, message: parsed.error }); continue }
          value = parsed.value
        }
        updates.push({ row: view[r]!, field: column.field, value })
      }
    }
    const result = setCells(updates)
    return { applied: result.applied, errors: [...errors, ...result.errors] }
  }

  // ---- rows ---------------------------------------------------------------

  /** Insert one new row before or after another row (default: at the end). Returns its key. */
  function insertRow(params: { before?: RowKey; after?: RowKey; values?: Partial<Row> } = {}): RowKey | undefined {
    if (readOnly) return undefined
    const key = `new:${nextNewKey++}`
    const row = { ...createRowValues(), ...params.values } as Row
    const anchor = params.before ?? params.after
    const offset = params.before !== undefined ? 0 : 1
    const naturalIndex = anchor === undefined ? -1 : order.indexOf(anchor)
    const at = naturalIndex < 0 ? order.length : naturalIndex + offset
    const viewAnchor = anchor === undefined ? undefined : viewPosition(anchor)
    const viewAt = viewAnchor === undefined ? view.length : viewAnchor + offset
    run('history', () => insertEntries([{ key, row, at, viewAt }]))
    return key
  }

  /** Copy rows; each copy is placed right after its original. Returns the new keys. */
  function duplicateRows(keys: readonly RowKey[]): RowKey[] {
    if (readOnly) return []
    const wanted = new Set(keys)
    const viewAfter = new Map<RowKey, number>()
    view.forEach((key, index) => { if (wanted.has(key)) viewAfter.set(key, index) })
    const entries: Entry<Row>[] = []
    let added = 0
    // Walk the natural order so positions account for copies inserted before them.
    order.forEach((key, index) => {
      if (!wanted.has(key)) return
      const row = { ...rows.get(key)! } as R
      const id = typeof idOption === 'string' ? idOption : undefined
      if (id) delete row[id]
      const viewAt = viewAfter.get(key)
      entries.push({ key: `new:${nextNewKey++}`, row, at: index + 1 + added, viewAt: viewAt === undefined ? -1 : viewAt + 1 })
      added++
    })
    // View positions must also account for earlier copies.
    const byView = entries.filter(entry => entry.viewAt >= 0).sort((a, b) => a.viewAt - b.viewAt)
    byView.forEach((entry, offset) => { entry.viewAt += offset })
    run('history', () => insertEntries(entries))
    return entries.map(entry => entry.key)
  }

  function deleteRows(keys: Iterable<RowKey>): number {
    if (readOnly) return 0
    return run('history', () => deleteKeys(keys))
  }

  // ---- history ------------------------------------------------------------

  function replay(ops: Op<Row>[], direction: 'undo' | 'redo') {
    const list = direction === 'undo' ? [...ops].reverse() : ops
    for (const op of list) {
      if (op.t === 'set') write(op.key, op.field, direction === 'undo' ? op.before : op.after)
      else if ((op.t === 'insert') === (direction === 'undo')) deleteKeys(op.entries.map(entry => entry.key))
      // Positions are clamped by spliceIn; rows that were hidden by a filter stay hidden.
      else insertEntries(op.entries)
    }
  }

  function undo() {
    const ops = undoStack.pop()
    if (!ops) return false
    run('none', () => replay(ops, 'undo'))
    redoStack.push(ops)
    emit()
    return true
  }

  function redo() {
    const ops = redoStack.pop()
    if (!ops) return false
    run('none', () => replay(ops, 'redo'))
    undoStack.push(ops)
    emit()
    return true
  }

  // ---- saving -------------------------------------------------------------

  function getChanges(): TableChanges<Row> {
    const updated: TableChanges<Row>['updated'] = []
    for (const [key, fields] of changed) {
      if (fields.size) updated.push({ id: getId(baseline.get(key)!), row: rows.get(key)!, changed: [...fields] as FieldKey<Row>[] })
    }
    return {
      created: [...created].map(key => rows.get(key)!),
      updated,
      deleted: [...deleted.values()].map(getId),
    }
  }

  function save(): Promise<SaveOutcome> {
    clearTimeout(autoSaveTimer)
    if (saving) {
      saveQueued = true
      return saving
    }
    if (!onSave) return Promise.resolve({ status: 'failed', error: 'No onSave handler.' })
    const invalidCells = [...invalid.values()].reduce((sum, errors) => sum + errors.size, 0)
    if (invalidCells) return Promise.resolve({ status: 'invalid', cells: invalidCells })
    const changes = getChanges()
    if (!changes.created.length && !changes.updated.length && !changes.deleted.length) return Promise.resolve({ status: 'nothing-to-save' })

    // What was sent, by key, so edits made during the save stay changed.
    const sentCreated = [...created].map(key => ({ key, row: rows.get(key)! }))
    const sentUpdated = [...changed.keys()].filter(key => changed.get(key)!.size).map(key => ({ key, row: rows.get(key)! }))
    const sentDeleted = [...deleted.keys()]
    const handler = onSave
    saveError = undefined
    const attempt = (async (): Promise<SaveOutcome> => {
      await Promise.resolve()
      let result: void | SaveResult<Row>
      try {
        result = await handler(changes)
      } catch (error) {
        saveError = error instanceof Error ? error.message : String(error)
        return { status: 'failed', error: saveError }
      }
      return settle(result ?? {}, sentCreated, sentUpdated, sentDeleted)
    })()
    const current = attempt.finally(() => {
      saving = null
      emit()
      if (saveQueued) {
        saveQueued = false
        void save()
      }
    })
    saving = current
    emit()
    return current
  }

  function settle(
    result: SaveResult<Row>,
    sentCreated: { key: RowKey; row: Row }[],
    sentUpdated: { key: RowKey; row: Row }[],
    sentDeleted: RowKey[],
  ): SaveOutcome {
    const failed = new Map<RowKey, string>()
    const keyById = new Map<RowId, RowKey>()
    for (const { key } of sentUpdated) keyById.set(getId(baseline.get(key)!), key)
    for (const key of sentDeleted) keyById.set(getId(baseline.get(key)!), key)
    for (const error of result.errors ?? []) {
      const key = error.created !== undefined ? sentCreated[error.created]?.key : error.id !== undefined ? keyById.get(error.id) : undefined
      if (key !== undefined) failed.set(key, error.field ? `${error.field}: ${error.message}` : error.message)
    }
    const serverUpdated = new Map((result.updated ?? []).map(row => [getId(row), row]))

    run('none', () => {
      saveErrors.clear()
      for (const [key, message] of failed) saveErrors.set(key, message)
      sentCreated.forEach(({ key, row }, index) => {
        if (failed.has(key)) return
        const server = result.created?.[index]
        accept(key, row, server)
        const id = getId(server ?? row)
        if (id !== undefined && id !== key) idAlias.set(id, key)
        if (rows.has(key)) created.delete(key)
        // Deleted while the save ran: it now exists on the server, so delete it there next time.
        else deleted.set(key, baseline.get(key)!)
      })
      for (const { key, row } of sentUpdated) {
        if (!failed.has(key)) accept(key, row, serverUpdated.get(getId(row)))
      }
      for (const key of sentDeleted) {
        if (failed.has(key)) continue
        const base = baseline.get(key)
        baseline.delete(key)
        deleted.delete(key)
        // Restored by undo while the save ran: it no longer exists on the server.
        if (rows.has(key) && base) created.add(key)
      }
    })
    emit()
    return { status: 'saved', errors: failed.size }
  }

  /** `sent` was saved; `server` is the server's version of it, if returned. */
  function accept(key: RowKey, sent: Row, server: Row | undefined) {
    const saved = server ?? sent
    baseline.set(key, saved)
    const current = rows.get(key)
    if (current && server && current !== server) {
      // Take the server's values for fields not edited since the save started.
      const merged = { ...current } as R
      let differs = false
      for (const field of Object.keys(server as object)) {
        const column = columnByField.get(field)
        if (sameValue(column, (current as R)[field], (sent as R)[field]) && !sameValue(column, merged[field], (server as R)[field])) {
          (merged as Record<string, unknown>)[field] = (server as R)[field]
          differs = true
        }
      }
      if (differs) rows.set(key, merged)
    }
    if (rows.has(key)) touch(key, 'all')
    changed.delete(key)
  }

  // ---- reading ------------------------------------------------------------

  function cell(key: RowKey, field: string): CellState {
    return {
      value: (rows.get(key) as R | undefined)?.[field] ?? null,
      changed: created.has(key) || (changed.get(key)?.has(field) ?? false),
      error: invalid.get(key)?.get(field) ?? undefined,
    }
  }

  function status(): TableStatus {
    let invalidCells = 0
    for (const errors of invalid.values()) invalidCells += errors.size
    let changedRows = created.size + deleted.size
    for (const fields of changed.values()) if (fields.size) changedRows++
    return {
      canUndo: undoStack.length > 0,
      canRedo: redoStack.length > 0,
      changedRows,
      invalidCells,
      saving: saving !== null,
      saveError,
    }
  }

  setColumns(options.columns)
  setData(options.data)
  version = 0

  return {
    // reading
    getVersion: () => version,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    getColumns: () => columns,
    getColumn: (field: string) => columnByField.get(field),
    /** Number of rows in the current view. */
    getRowCount: () => view.length,
    /** Row key at a view position. */
    getRowKey: (index: number) => view[index],
    getRowIndex: viewPosition,
    getRow: (key: RowKey) => rows.get(key),
    getRowById: (id: RowId) => rows.get(idAlias.get(id) ?? id),
    /** All current rows in natural order, including unsaved changes. */
    getRows: () => order.map(key => rows.get(key)!),
    getCell: cell,
    isNewRow: (key: RowKey) => created.has(key),
    isRowChanged: (key: RowKey) => created.has(key) || (changed.get(key)?.size ?? 0) > 0,
    getRowSaveError: (key: RowKey) => saveErrors.get(key),
    getChanges,
    getStatus: status,
    getView: () => ({ filters, sort, search }),
    canEdit: (key: RowKey, field: string) => editable(key, field) === undefined,
    isReadOnly: () => readOnly,
    // editing
    parseCell,
    setCell,
    setCellText,
    setCells,
    copy,
    canCopyAll,
    paste,
    clear,
    setValue,
    previewBulkEdit,
    bulkEdit,
    updateCells,
    fill,
    insertRow,
    duplicateRows,
    deleteRows,
    undo,
    redo,
    // view
    setFilters: (next: readonly Filter[]) => setView({ filters: next }),
    setSort: (next: readonly Sort[]) => setView({ sort: next }),
    setSearch: (next: string) => setView({ search: next }),
    /** Re-apply filter and sort to edited rows. */
    refreshView: () => setView({}),
    // data
    setData,
    setColumns,
    save,
    /** Update options that may change between renders. */
    configure(next: Pick<TableOptions<Row>, 'onSave' | 'autoSave' | 'readOnly' | 'createRow'>) {
      onSave = next.onSave
      autoSave = next.autoSave
      createRowValues = next.createRow ?? (() => ({}))
      if ((next.readOnly ?? false) !== readOnly) {
        readOnly = next.readOnly ?? false
        emit()
      }
    },
    destroy() {
      clearTimeout(autoSaveTimer)
      listeners.clear()
    },
  }
}

const optionKeys = new WeakMap<object, string>()
function sameOptions(a: ResolvedColumn, b: ResolvedColumn) {
  const key = (column: ResolvedColumn) => {
    let cached = optionKeys.get(column)
    if (cached === undefined) {
      cached = JSON.stringify(column.options ?? null)
      optionKeys.set(column, cached)
    }
    return cached
  }
  return key(a) === key(b)
}

function setFlag(map: Map<RowKey, Set<string>>, key: RowKey, field: string, on: boolean) {
  const fields = map.get(key)
  if (on) {
    if (fields) fields.add(field)
    else map.set(key, new Set([field]))
  } else if (fields) {
    fields.delete(field)
    if (!fields.size) map.delete(key)
  }
}

/** Insert entries into a key list at their target positions in O(n + k). */
function spliceIn<Row>(list: RowKey[], entries: Entry<Row>[], position: (entry: Entry<Row>) => number): RowKey[] {
  const placed = entries.filter(entry => position(entry) >= 0).sort((a, b) => position(a) - position(b))
  if (!placed.length) return list
  const result: RowKey[] = []
  let source = 0
  for (const entry of placed) {
    const at = Math.min(position(entry), list.length + result.length - source)
    while (result.length < at && source < list.length) result.push(list[source++]!)
    result.push(entry.key)
  }
  while (source < list.length) result.push(list[source++]!)
  return result
}

const mod = (value: number, size: number) => ((value % size) + size) % size
