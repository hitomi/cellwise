import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { isParseError } from '../core/field-type.js'
import type { CellRange, Filter, Sort, Table, TableOptions } from '../core/table.js'
import { isBuiltin, shortcut } from './cells.js'
import { BulkEditor } from './bulk-editor.js'
import { Grid, type GridHandle } from './grid.js'
import { useDataTable, useTableVersion } from './use-data-table.js'

export interface DataTableViewProps<Row> {
  /** Row height in px. Default 34. */
  rowHeight?: number
  className?: string
  style?: CSSProperties
  /** Replace or hide (`false`) the toolbar. */
  toolbar?: false | ((table: Table<Row>) => ReactNode)
  /** Hide the status bar. */
  statusBar?: boolean
}

export type DataTableProps<Row> = DataTableViewProps<Row> & ({ table: Table<Row> } | TableOptions<Row>)

/** Spreadsheet-like editor. Pass `data`, `columns` and `onSave`, or a `table` from `useDataTable`. */
export function DataTable<Row>(props: DataTableProps<Row>) {
  return 'table' in props ? <DataTableView {...props} /> : <OwnedDataTable {...props} />
}

function OwnedDataTable<Row>(props: DataTableViewProps<Row> & TableOptions<Row>) {
  const table = useDataTable(props)
  return <DataTableView {...props} table={table} />
}

function DataTableView<Row>({ table, rowHeight = 34, className, style, toolbar, statusBar = true }: DataTableViewProps<Row> & { table: Table<Row> }) {
  const [notice, setNotice] = useState<string>()
  const [selection, setSelection] = useState<CellRange[]>([{ rowStart: 0, rowEnd: 0, colStart: 0, colEnd: 0 }])
  const [bulkRanges, setBulkRanges] = useState<CellRange[] | null>(null)
  const grid = useRef<GridHandle | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const showNotice = useCallback((message: string) => {
    setNotice(message)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setNotice(undefined), 4000)
  }, [])
  const setHandle = useCallback((handle: GridHandle) => { grid.current = handle }, [])

  return (
    <div className={`cw-root${className ? ` ${className}` : ''}`} style={style}>
      {toolbar === undefined
        ? <Toolbar table={table} grid={grid} onNotice={showNotice} selection={selection} onBulkEdit={() => setBulkRanges(selection)} />
        : toolbar === false ? null : toolbar(table)}
      <Grid table={table} rowHeight={rowHeight} onNotice={showNotice} onSelectionChange={setSelection} onBulkEdit={setBulkRanges} handleRef={setHandle} />
      {statusBar && <StatusBar table={table} selection={selection} notice={notice} />}
      {bulkRanges && (
        <BulkEditor table={table} ranges={bulkRanges} onClose={result => {
          setBulkRanges(null)
          grid.current?.focus()
          if (result) showNotice(`Changed ${result.applied.toLocaleString()} ${result.applied === 1 ? 'cell' : 'cells'}${result.errors.length ? `, skipped ${result.errors.length.toLocaleString()}` : ''}`)
        }} />
      )}
    </div>
  )
}

// ---- toolbar ----------------------------------------------------------------

function selectedCells(ranges: CellRange[]) {
  return ranges.reduce((sum, r) => sum + (r.rowEnd - r.rowStart + 1) * (r.colEnd - r.colStart + 1), 0)
}

function Toolbar({ table, grid, onNotice, selection, onBulkEdit }: {
  table: Table<any>
  grid: React.RefObject<GridHandle | null>
  onNotice(message: string): void
  selection: CellRange[]
  onBulkEdit(): void
}) {
  useTableVersion(table)
  const status = table.getStatus()
  const view = table.getView()
  const [search, setSearch] = useState(view.search)
  const [open, setOpen] = useState<'filter' | 'sort' | null>(null)

  useEffect(() => {
    const id = setTimeout(() => { if (search !== table.getView().search) table.setSearch(search) }, 150)
    return () => clearTimeout(id)
  }, [search, table])

  async function save() {
    const outcome = await table.save()
    if (outcome.status === 'invalid') onNotice(`Fix ${outcome.cells} invalid ${outcome.cells === 1 ? 'cell' : 'cells'} before saving`)
    else if (outcome.status === 'saved' && outcome.errors) onNotice(`${outcome.errors} ${outcome.errors === 1 ? 'row was' : 'rows were'} not saved`)
  }

  function addRow() {
    const key = table.insertRow()
    const r = key === undefined ? undefined : table.getRowIndex(key)
    if (r !== undefined) grid.current?.selectCell({ r, c: 0 })
  }

  return (
    <div className="cw-toolbar" role="toolbar">
      <input className="cw-search" type="search" placeholder="Search" value={search} onChange={event => setSearch(event.target.value)} aria-label="Search" />
      <div className="cw-popover-anchor">
        <button type="button" className="cw-button" data-active={view.filters.length > 0 || undefined} onClick={() => setOpen(open === 'filter' ? null : 'filter')}>
          Filter{view.filters.length ? ` · ${view.filters.length}` : ''}
        </button>
        {open === 'filter' && <Popover onClose={() => setOpen(null)}><FilterEditor table={table} /></Popover>}
      </div>
      <div className="cw-popover-anchor">
        <button type="button" className="cw-button" data-active={view.sort.length > 0 || undefined} onClick={() => setOpen(open === 'sort' ? null : 'sort')}>
          Sort{view.sort.length ? ` · ${view.sort.length}` : ''}
        </button>
        {open === 'sort' && <Popover onClose={() => setOpen(null)}><SortEditor table={table} /></Popover>}
      </div>
      <span className="cw-divider" />
      <button type="button" className="cw-button" onClick={addRow} disabled={table.isReadOnly()}>+ Row</button>
      {selectedCells(selection) > 1 && table.getRowCount() > 0 && (
        <button type="button" className="cw-button" onClick={onBulkEdit} title={`Edit selected cells (${shortcut('E')})`}>
          Edit {selectedCells(selection).toLocaleString()} cells
        </button>
      )}
      <button type="button" className="cw-button cw-icon" onClick={() => table.undo()} disabled={!status.canUndo} title={`Undo (${shortcut('Z')})`} aria-label="Undo">↶</button>
      <button type="button" className="cw-button cw-icon" onClick={() => table.redo()} disabled={!status.canRedo} title={`Redo (${shortcut('Shift+Z')})`} aria-label="Redo">↷</button>
      <span className="cw-spacer" />
      {table.isReadOnly() && <span className="cw-readonly-tag"><span aria-hidden="true">🔒</span> Read-only</span>}
      <span className="cw-save-status" data-error={status.saveError ? true : undefined} role="status">
        {status.saving ? 'Saving…'
          : status.saveError ? `Save failed: ${status.saveError}`
            : status.invalidCells ? `${status.invalidCells} invalid ${status.invalidCells === 1 ? 'cell' : 'cells'}`
              : status.changedRows ? `${status.changedRows} unsaved ${status.changedRows === 1 ? 'row' : 'rows'}`
                : 'All changes saved'}
      </span>
      <button type="button" className="cw-button cw-primary" onClick={() => void save()} disabled={status.saving || !status.changedRows}>
        Save
      </button>
    </div>
  )
}

function Popover({ children, onClose }: { children: ReactNode; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (event: MouseEvent) => {
      const anchor = ref.current?.parentElement
      if (anchor && !anchor.contains(event.target as Node)) onClose()
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', escape) }
  }, [onClose])
  return <div ref={ref} className="cw-popover">{children}</div>
}

/** Filter value input: text parsed with the column's type, or a picker for select columns. */
function FilterValue({ table, filter, onChange }: { table: Table<any>; filter: Filter; onChange(value: unknown): void }) {
  const column = table.getColumn(filter.field)!
  const operator = column.type.filters[filter.operator]
  const input = operator?.input ?? 'value'
  const [text, setText] = useState(() => {
    if (filter.value === undefined || filter.value === null) return ''
    if (Array.isArray(filter.value)) return filter.value.map(entry => column.type.format(entry, column.options)).join(', ')
    return column.type.format(filter.value, column.options)
  })
  const [error, setError] = useState<string>()
  if (input === 'none') return null
  const options = (column.options as { options?: readonly (string | { value: string; label?: string })[] }).options
  if (options && (isBuiltin(column, 'select') || isBuiltin(column, 'multiSelect'))) {
    const selected = Array.isArray(filter.value) ? filter.value as string[] : filter.value === undefined ? [] : [filter.value as string]
    return (
      <select className="cw-select" multiple={input === 'values'} value={input === 'values' ? selected : selected[0] ?? ''}
        onChange={event => onChange(input === 'values' ? [...event.target.selectedOptions].map(option => option.value) : event.target.value)}>
        {input !== 'values' && <option value="">Choose…</option>}
        {options.map(option => {
          const value = typeof option === 'string' ? option : option.value
          return <option key={value} value={value}>{typeof option === 'string' ? option : option.label ?? option.value}</option>
        })}
      </select>
    )
  }
  return (
    <input className="cw-input-small" value={text} placeholder="Value" title={error} data-invalid={error ? true : undefined}
      onChange={event => {
        const next = event.target.value
        setText(next)
        if (next.trim() === '') { setError(undefined); onChange(undefined); return }
        // Text filters match raw text; other types parse the value first.
        if (isBuiltin(column, 'text')) { setError(undefined); onChange(next); return }
        const parts = input === 'values' ? next.split(',') : [next]
        const values: unknown[] = []
        for (const part of parts) {
          const parsed = column.type.parse(part, column.options)
          if (isParseError(parsed)) { setError(parsed.error); return }
          values.push(parsed)
        }
        setError(undefined)
        onChange(input === 'values' ? values : values[0])
      }} />
  )
}

function FilterEditor({ table }: { table: Table<any> }) {
  useTableVersion(table)
  const filters = table.getView().filters
  const columns = table.getColumns().filter(column => column.filterable)
  const update = (index: number, next: Filter | null) =>
    table.setFilters(next ? filters.map((filter, i) => i === index ? next : filter) : filters.filter((_, i) => i !== index))
  // Incomplete conditions are kept but match everything.
  const firstOperator = (field: string) => Object.keys(table.getColumn(field)!.type.filters)[0]!
  return (
    <div className="cw-conditions">
      {!filters.length && <div className="cw-hint">No filters. Rows matching every condition are shown.</div>}
      {filters.map((filter, index) => {
        const column = table.getColumn(filter.field)
        if (!column) return null
        return (
          <div className="cw-condition" key={index}>
            <span className="cw-hint">{index === 0 ? 'Where' : 'and'}</span>
            <select className="cw-select" value={filter.field} onChange={event => update(index, { field: event.target.value, operator: firstOperator(event.target.value) })}>
              {columns.map(entry => <option key={entry.field} value={entry.field}>{entry.title}</option>)}
            </select>
            <select className="cw-select" value={filter.operator} onChange={event => update(index, { field: filter.field, operator: event.target.value })}>
              {Object.entries(column.type.filters).map(([name, operator]) => <option key={name} value={name}>{operator.label}</option>)}
            </select>
            <FilterValue key={`${filter.field}:${filter.operator}`} table={table} filter={filter}
              onChange={value => update(index, { ...filter, value })} />
            <button type="button" className="cw-button cw-icon" aria-label="Remove condition" onClick={() => update(index, null)}>×</button>
          </div>
        )
      })}
      {columns[0] && (
        <button type="button" className="cw-link" onClick={() => table.setFilters([...filters, { field: columns[0]!.field, operator: firstOperator(columns[0]!.field) }])}>
          + Add condition
        </button>
      )}
    </div>
  )
}

function SortEditor({ table }: { table: Table<any> }) {
  useTableVersion(table)
  const sort = table.getView().sort
  const columns = table.getColumns().filter(column => column.sortable)
  const set = (next: Sort[]) => table.setSort(next)
  return (
    <div className="cw-conditions">
      {!sort.length && <div className="cw-hint">No sorting. Rows keep their original order.</div>}
      {sort.map((entry, index) => (
        <div className="cw-condition" key={index}>
          <span className="cw-hint">{index === 0 ? 'Sort by' : 'then by'}</span>
          <select className="cw-select" value={entry.field} onChange={event => set(sort.map((item, i) => i === index ? { ...item, field: event.target.value } : item))}>
            {columns.map(column => <option key={column.field} value={column.field}>{column.title}</option>)}
          </select>
          <select className="cw-select" value={entry.direction}
            onChange={event => set(sort.map((item, i) => i === index ? { ...item, direction: event.target.value as Sort['direction'] } : item))}>
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
          <button type="button" className="cw-button cw-icon" aria-label="Remove sort" onClick={() => set(sort.filter((_, i) => i !== index))}>×</button>
        </div>
      ))}
      {columns.length > sort.length && (
        <button type="button" className="cw-link"
          onClick={() => set([...sort, { field: columns.find(column => !sort.some(entry => entry.field === column.field))!.field, direction: 'asc' }])}>
          + Add sort
        </button>
      )}
    </div>
  )
}

// ---- status bar ---------------------------------------------------------------

function StatusBar({ table, selection, notice }: { table: Table<any>; selection: CellRange[]; notice: string | undefined }) {
  useTableVersion(table)
  const rowCount = table.getRowCount()
  const total = table.getRows().length
  const cells = selectedCells(selection)
  let sum = 0, numbers = 0
  // Summing is skipped for very large selections to keep the bar cheap.
  if (cells > 1 && cells <= 200_000 && rowCount) {
    const columns = table.getColumns()
    for (const range of selection) {
      for (let c = range.colStart; c <= range.colEnd; c++) {
        if (!columns[c] || !isBuiltin(columns[c]!, 'number')) continue
        for (let r = range.rowStart; r <= range.rowEnd; r++) {
          const value = table.getCell(table.getRowKey(r)!, columns[c]!.field).value
          if (typeof value === 'number') { sum += value; numbers++ }
        }
      }
    }
  }
  return (
    <div className="cw-statusbar">
      <span>{rowCount === total ? `${total.toLocaleString()} rows` : `${rowCount.toLocaleString()} of ${total.toLocaleString()} rows`}</span>
      {cells > 1 && <span>{cells.toLocaleString()} cells selected</span>}
      {numbers > 0 && <span>Sum {Number(sum.toFixed(10)).toLocaleString()}</span>}
      {notice && <span className="cw-notice" role="alert">{notice}</span>}
    </div>
  )
}
