import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { isParseError } from '../core/field-type.js'
import type { Messages } from '../core/messages.js'
import type { CellRange, EditResult, Filter, SaveOutcome, Sort, Table, TableOptions } from '../core/table.js'
import { BulkEditor } from './bulk-editor.js'
import { isBuiltin, shortcut } from './cells.js'
import { Grid, type GridHandle } from './grid.js'
import { ContextMenu, quickActionColumns, quickActionItems, type Menu } from './menu.js'
import { MessagesContext } from './messages-context.js'
import { useDataTable, useTableVersion } from './use-data-table.js'

export interface ToolbarOptions {
  search?: boolean
  filter?: boolean
  sort?: boolean
  addRow?: boolean
  undo?: boolean
  /** "Quick edit" menu with the field types' one-click edits for the selected cells. */
  quickActions?: boolean
  /** Shown after the built-in controls on the left, e.g. a view switch. */
  start?: ReactNode
  /** Shown before the save status and button on the right, e.g. a note input. */
  end?: ReactNode
  /** Save button text; default "Save". */
  saveLabel?: (changedRows: number) => string
}

export interface DataTableViewProps<Row> {
  /** Accessible name of the grid, e.g. "Products". */
  ariaLabel?: string
  /** Row height in px. Default 34. */
  rowHeight?: number
  /** Header height in px. Default 36. */
  headerHeight?: number
  className?: string
  style?: CSSProperties
  /** Show the loading text while the first data is on its way. */
  loading?: boolean
  /** Configure, replace (function) or hide (`false`) the toolbar. */
  toolbar?: false | ToolbarOptions | ((table: Table<Row>) => ReactNode)
  /** Hide the status bar. */
  statusBar?: boolean
  /** Called after each save attempt started from the table (button, ⌘S, auto-save excluded). */
  onSaved?: (outcome: SaveOutcome) => void
  /**
   * Short feedback (a skipped paste, a blocked save, a read-only cell). By default it shows in
   * the status bar; pass a function to show it elsewhere, e.g. as a toast.
   */
  onNotice?: (message: string) => void
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

/** A short message for a save that did not happen, or `undefined` when there is nothing to say. */
export function saveOutcomeMessage(outcome: SaveOutcome, messages: Messages) {
  switch (outcome.status) {
    case 'invalid': return messages.ui.fixInvalid(outcome.cells)
    case 'conflict': return messages.ui.resolveConflicts(outcome.cells)
    case 'failed': return messages.ui.saveFailed(outcome.error)
    case 'saved': return outcome.errors ? messages.ui.rowsNotSaved(outcome.errors) : undefined
    default: return undefined
  }
}

function DataTableView<Row>({
  table, ariaLabel, rowHeight = 34, headerHeight, className, style, loading, toolbar, statusBar = true, onSaved, onNotice,
}: DataTableViewProps<Row> & { table: Table<Row> }) {
  useTableVersion(table)
  const messages = table.getMessages()
  const [notice, setNotice] = useState<string>()
  const [selection, setSelection] = useState<CellRange[]>([{ rowStart: 0, rowEnd: 0, colStart: 0, colEnd: 0 }])
  const [bulkRanges, setBulkRanges] = useState<CellRange[] | null>(null)
  const grid = useRef<GridHandle | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const onNoticeRef = useRef(onNotice)
  onNoticeRef.current = onNotice
  const showNotice = useCallback((message: string) => {
    if (onNoticeRef.current) { onNoticeRef.current(message); return }
    setNotice(message)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setNotice(undefined), 4000)
  }, [])
  const setHandle = useCallback((handle: GridHandle) => { grid.current = handle }, [])
  const onSavedRef = useRef(onSaved)
  onSavedRef.current = onSaved
  const save = useCallback(async () => {
    const outcome = await table.save()
    // An app that handles `onSaved` reports the outcome itself.
    if (onSavedRef.current) onSavedRef.current(outcome)
    else {
      const message = saveOutcomeMessage(outcome, table.getMessages())
      if (message) showNotice(message)
    }
    return outcome
  }, [table, showNotice])

  return (
    <MessagesContext.Provider value={messages}>
      <div className={`cw-root${className ? ` ${className}` : ''}`} style={style} lang={messages.locale}>
        {toolbar === false ? null : typeof toolbar === 'function' ? toolbar(table) : (
          <Toolbar table={table} grid={grid} options={toolbar ?? {}} save={save}
            selection={selection} onBulkEdit={() => setBulkRanges(selection)} onNotice={showNotice} />
        )}
        <Grid table={table} rowHeight={rowHeight} {...(headerHeight === undefined ? {} : { headerHeight })} {...(ariaLabel === undefined ? {} : { ariaLabel })}
          loading={loading ?? false} onNotice={showNotice} onSave={save}
          onSelectionChange={setSelection} onBulkEdit={setBulkRanges} handleRef={setHandle} />
        {statusBar && <StatusBar table={table} selection={selection} notice={notice} />}
        {bulkRanges && (
          <BulkEditor table={table} ranges={bulkRanges} onClose={result => {
            setBulkRanges(null)
            grid.current?.focus()
            if (result) {
              const skipped = result.errors.length ? `, ${messages.ui.skipped(result.errors.length)}` : ''
              showNotice(`${messages.ui.changedCells(result.applied)}${skipped}`)
            }
          }} />
        )}
      </div>
    </MessagesContext.Provider>
  )
}

// ---- toolbar ----------------------------------------------------------------

function selectedCells(ranges: CellRange[]) {
  return ranges.reduce((sum, r) => sum + (r.rowEnd - r.rowStart + 1) * (r.colEnd - r.colStart + 1), 0)
}

function Toolbar({ table, grid, options, save, selection, onBulkEdit, onNotice }: {
  table: Table<any>
  grid: React.RefObject<GridHandle | null>
  options: ToolbarOptions
  save(): Promise<SaveOutcome>
  selection: CellRange[]
  onBulkEdit(): void
  onNotice(message: string): void
}) {
  useTableVersion(table)
  const m = table.getMessages().ui
  const status = table.getStatus()
  const view = table.getView()
  const [search, setSearch] = useState(view.search)
  const [open, setOpen] = useState<'filter' | 'sort' | null>(null)
  const show = (part: keyof ToolbarOptions) => options[part] !== false

  useEffect(() => {
    const id = setTimeout(() => { if (search !== table.getView().search) table.setSearch(search) }, 150)
    return () => clearTimeout(id)
  }, [search, table])

  function addRow() {
    const key = table.insertRow()
    const r = key === undefined ? undefined : table.getRowIndex(key)
    if (r !== undefined) grid.current?.selectCell({ r, c: 0 })
  }

  const cells = selectedCells(selection)
  return (
    <div className="cw-toolbar" role="toolbar">
      {show('search') && (
        <input className="cw-search" type="search" placeholder={m.search} value={search} onChange={event => setSearch(event.target.value)} aria-label={m.search} />
      )}
      {show('filter') && (
        <div className="cw-popover-anchor">
          <button type="button" className="cw-button" data-active={view.filters.length > 0 || undefined} onClick={() => setOpen(open === 'filter' ? null : 'filter')}>
            {m.filter}{view.filters.length ? ` · ${view.filters.length}` : ''}
          </button>
          {open === 'filter' && <Popover onClose={() => setOpen(null)}><FilterEditor table={table} /></Popover>}
        </div>
      )}
      {show('sort') && (
        <div className="cw-popover-anchor">
          <button type="button" className="cw-button" data-active={view.sort.length > 0 || undefined} onClick={() => setOpen(open === 'sort' ? null : 'sort')}>
            {m.sort}{view.sort.length ? ` · ${view.sort.length}` : ''}
          </button>
          {open === 'sort' && <Popover onClose={() => setOpen(null)}><SortEditor table={table} /></Popover>}
        </div>
      )}
      {(show('search') || show('filter') || show('sort')) && <span className="cw-divider" />}
      {show('addRow') && table.canInsertRows() && <button type="button" className="cw-button" onClick={addRow}>{m.addRow}</button>}
      {cells > 1 && table.getRowCount() > 0 && !table.isReadOnly() && (
        <button type="button" className="cw-button" onClick={onBulkEdit} title={`${m.editCells(cells)} (${shortcut('E')})`}>
          {m.editCells(cells)}
        </button>
      )}
      {show('quickActions') && <QuickEditButton table={table} grid={grid} selection={selection} onNotice={onNotice} />}
      {show('undo') && (
        <>
          <button type="button" className="cw-button cw-icon" onClick={() => table.undo()} disabled={!status.canUndo} title={`${m.undo} (${shortcut('Z')})`} aria-label={m.undo}><UndoIcon /></button>
          <button type="button" className="cw-button cw-icon" onClick={() => table.redo()} disabled={!status.canRedo} title={`${m.redo} (${shortcut('Shift+Z')})`} aria-label={m.redo}><UndoIcon redo /></button>
        </>
      )}
      {options.start}
      <span className="cw-spacer" />
      {options.end}
      {table.isReadOnly() && <span className="cw-readonly-tag"><span aria-hidden="true">🔒</span> {m.readOnly}</span>}
      <span className="cw-save-status" data-error={status.saveError || status.conflictCells ? true : undefined} role="status">
        {status.saving ? m.saving
          : status.saveError ? m.saveFailed(status.saveError)
            : status.conflictCells ? m.conflicts(status.conflictCells)
              : status.invalidCells ? m.invalidCells(status.invalidCells)
                : status.changedRows ? m.unsavedRows(status.changedRows)
                  : m.saved}
      </span>
      {!table.isReadOnly() && (
        <button type="button" className="cw-button cw-primary" onClick={() => void save()}
          disabled={status.saving || (!status.changedRows && !status.editing)}>
          {options.saveLabel ? options.saveLabel(status.changedRows) : m.save}
        </button>
      )}
    </div>
  )
}

/** Opens the quick edits of the selected cells under the button; hidden when there are none. */
function QuickEditButton({ table, grid, selection, onNotice }: {
  table: Table<any>
  grid: React.RefObject<GridHandle | null>
  selection: CellRange[]
  onNotice(message: string): void
}) {
  const m = table.getMessages().ui
  const button = useRef<HTMLButtonElement>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const close = useCallback(() => { setMenu(null); grid.current?.focus() }, [grid])
  if (!quickActionColumns(table, selection).length) return null
  const report = (result: EditResult) => {
    if (!result.errors.length) return
    const first = result.errors[0]!
    onNotice(result.errors.length === 1 ? first.message : `${m.skipped(result.errors.length)} (${first.message})`)
  }
  return (
    <>
      <button ref={button} type="button" className="cw-button" aria-haspopup="menu" aria-expanded={!!menu}
        data-active={menu ? true : undefined}
        onClick={() => {
          if (menu) { close(); return }
          const rect = button.current!.getBoundingClientRect()
          setMenu({ x: rect.left, y: rect.bottom + 4 })
        }}>
        {m.quickEdit} <span aria-hidden="true">▾</span>
      </button>
      {menu && <ContextMenu menu={menu} anchor={button} onClose={close} items={quickActionItems(table, selection, report)} />}
    </>
  )
}

/** Curved-arrow undo/redo icon (shapes after Lucide's undo-2/redo-2, ISC license). */
function UndoIcon({ redo }: { redo?: boolean }) {
  return (
    <svg className="cw-icon-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={redo ? { transform: 'scaleX(-1)' } : undefined}>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </svg>
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
  const m = table.getMessages().ui
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
        {input !== 'values' && <option value="">{m.chooseOption}</option>}
        {options.map(option => {
          const value = typeof option === 'string' ? option : option.value
          return <option key={value} value={value}>{typeof option === 'string' ? option : option.label ?? option.value}</option>
        })}
      </select>
    )
  }
  return (
    <input className="cw-input-small" value={text} placeholder={m.value} title={error} data-invalid={error ? true : undefined}
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

/** Label of a filter operator; the shared empty/not-empty operators use the table's messages. */
function operatorLabel(table: Table<any>, name: string, label: string) {
  const filters = table.getMessages().filters
  return name === 'isEmpty' || name === 'isNotEmpty' ? filters[name] : label
}

function FilterEditor({ table }: { table: Table<any> }) {
  useTableVersion(table)
  const m = table.getMessages().ui
  const filters = table.getView().filters
  const columns = table.getColumns().filter(column => column.filterable)
  const update = (index: number, next: Filter | null) =>
    table.setFilters(next ? filters.map((filter, i) => i === index ? next : filter) : filters.filter((_, i) => i !== index))
  // Incomplete conditions are kept but match everything.
  const firstOperator = (field: string) => Object.keys(table.getColumn(field)!.type.filters)[0]!
  return (
    <div className="cw-conditions">
      {!filters.length && <div className="cw-hint">{m.noFilters}</div>}
      {filters.map((filter, index) => {
        const column = table.getColumn(filter.field)
        if (!column) return null
        return (
          <div className="cw-condition" key={index}>
            <span className="cw-hint">{index === 0 ? m.filterWhere : m.filterAnd}</span>
            <select className="cw-select" value={filter.field} onChange={event => update(index, { field: event.target.value, operator: firstOperator(event.target.value) })}>
              {columns.map(entry => <option key={entry.field} value={entry.field}>{entry.title}</option>)}
            </select>
            <select className="cw-select" value={filter.operator} onChange={event => update(index, { field: filter.field, operator: event.target.value })}>
              {Object.entries(column.type.filters).map(([name, operator]) => <option key={name} value={name}>{operatorLabel(table, name, operator.label)}</option>)}
            </select>
            <FilterValue key={`${filter.field}:${filter.operator}`} table={table} filter={filter}
              onChange={value => update(index, { ...filter, value })} />
            <button type="button" className="cw-button cw-icon" aria-label={m.removeCondition} onClick={() => update(index, null)}>×</button>
          </div>
        )
      })}
      {columns[0] && (
        <button type="button" className="cw-link" onClick={() => table.setFilters([...filters, { field: columns[0]!.field, operator: firstOperator(columns[0]!.field) }])}>
          {m.addCondition}
        </button>
      )}
    </div>
  )
}

function SortEditor({ table }: { table: Table<any> }) {
  useTableVersion(table)
  const m = table.getMessages().ui
  const sort = table.getView().sort
  const columns = table.getColumns().filter(column => column.sortable)
  const set = (next: Sort[]) => table.setSort(next)
  return (
    <div className="cw-conditions">
      {!sort.length && <div className="cw-hint">{m.noSorting}</div>}
      {sort.map((entry, index) => (
        <div className="cw-condition" key={index}>
          <span className="cw-hint">{index === 0 ? m.sortBy : m.thenBy}</span>
          <select className="cw-select" value={entry.field} onChange={event => set(sort.map((item, i) => i === index ? { ...item, field: event.target.value } : item))}>
            {columns.map(column => <option key={column.field} value={column.field}>{column.title}</option>)}
          </select>
          <select className="cw-select" value={entry.direction}
            onChange={event => set(sort.map((item, i) => i === index ? { ...item, direction: event.target.value as Sort['direction'] } : item))}>
            <option value="asc">{m.ascending}</option>
            <option value="desc">{m.descending}</option>
          </select>
          <button type="button" className="cw-button cw-icon" aria-label={m.removeCondition} onClick={() => set(sort.filter((_, i) => i !== index))}>×</button>
        </div>
      ))}
      {columns.length > sort.length && (
        <button type="button" className="cw-link"
          onClick={() => set([...sort, { field: columns.find(column => !sort.some(entry => entry.field === column.field))!.field, direction: 'asc' }])}>
          {m.addSort}
        </button>
      )}
    </div>
  )
}

// ---- status bar ---------------------------------------------------------------

function StatusBar({ table, selection, notice }: { table: Table<any>; selection: CellRange[]; notice: string | undefined }) {
  useTableVersion(table)
  const m = table.getMessages().ui
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
          const key = table.getRowKey(r)
          const value = key === undefined ? null : table.getCell(key, columns[c]!.field).value
          if (typeof value === 'number') { sum += value; numbers++ }
        }
      }
    }
  }
  return (
    <div className="cw-statusbar">
      <span>{rowCount === total ? m.rows(total) : m.rowsOfTotal(rowCount, total)}</span>
      {cells > 1 && <span>{m.cellsSelected(cells)}</span>}
      {numbers > 0 && <span>{m.sum} {Number(sum.toFixed(10)).toLocaleString(table.getMessages().locale)}</span>}
      {notice && <span className="cw-notice" role="alert">{notice}</span>}
    </div>
  )
}
