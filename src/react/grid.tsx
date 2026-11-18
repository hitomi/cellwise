import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ResolvedColumn } from '../core/columns.js'
import { acceptsFile, isParseError, type QuickAction } from '../core/field-type.js'
import type { CellRange, EditResult, RowKey, Table } from '../core/table.js'
import { cellAlign, editorFor, isBuiltin, renderCell, shortcut } from './cells.js'
import { MessagesContext, useMessages } from './messages-context.js'
import { useTableVersion } from './use-data-table.js'

const DEFAULT_HEADER_HEIGHT = 36
const GUTTER = 56
const OVERSCAN_ROWS = 6
const OVERSCAN_PX = 300
/** Space after the last row and column, so the fill handle on the corner is never cut off. */
const EDGE_ROOM = 8

interface Pos { r: number; c: number }
interface Selection { anchor: Pos; focus: Pos }
interface Editing { id: number; r: number; c: number; key: RowKey; field: string; initialText?: string }
interface Menu { x: number; y: number }

export interface GridHandle {
  selectCell(pos: Pos): void
  focus(): void
}

interface GridProps {
  table: Table<any>
  rowHeight: number
  headerHeight?: number
  ariaLabel?: string
  /** Show the loading text instead of the empty state. */
  loading?: boolean
  onNotice(message: string): void
  onSave(): void
  /** Selected ranges; the last one holds the active cell. */
  onSelectionChange(ranges: CellRange[]): void
  onBulkEdit(ranges: CellRange[]): void
  handleRef?: (handle: GridHandle) => void
}

const toRange = ({ anchor, focus }: Selection): CellRange => ({
  rowStart: Math.min(anchor.r, focus.r), rowEnd: Math.max(anchor.r, focus.r),
  colStart: Math.min(anchor.c, focus.c), colEnd: Math.max(anchor.c, focus.c),
})
const inRange = (range: CellRange, pos: Pos) => pos.r >= range.rowStart && pos.r <= range.rowEnd && pos.c >= range.colStart && pos.c <= range.colEnd
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

export function Grid({ table, rowHeight, headerHeight, ariaLabel, loading, onNotice, onSave, onSelectionChange, onBulkEdit, handleRef }: GridProps) {
  useTableVersion(table)
  const HEADER_HEIGHT = headerHeight ?? DEFAULT_HEADER_HEIGHT
  const messages = table.getMessages()
  const m = messages.ui
  const columns = table.getColumns()
  const rowCount = table.getRowCount()
  const sorts = table.getView().sort

  const scroller = useRef<HTMLDivElement>(null)
  const sink = useRef<HTMLTextAreaElement>(null)
  const [viewport, setViewport] = useState({ top: 0, left: 0, width: 800, height: 600 })
  const [widths, setWidths] = useState<Record<string, number>>({})
  // Several ranges with ⌘/Ctrl; the last one is where the active cell is.
  const [selections, setSelections] = useState<Selection[]>([{ anchor: { r: 0, c: 0 }, focus: { r: 0, c: 0 } }])
  const setSelection = (next: Selection) => setSelections([next])
  const setLastSelection = (next: Selection) => setSelections(list => [...list.slice(0, -1), next])
  const [editing, setEditingState] = useState<Editing | null>(null)
  // The open edit session, read by commits that arrive late (e.g. an editor's blur after it closed).
  const editingRef = useRef<Editing | null>(null)
  // The editor's current value, so the grid can commit it from outside (save, navigation guards).
  const draftRef = useRef<{ value: unknown } | { error: string } | null>(null)
  const setEditing = (next: Editing | null) => {
    editingRef.current = next
    draftRef.current = null
    setEditingState(next)
    table.notify()
  }
  const [dropCell, setDropCell] = useState<Pos | null>(null)
  const [uploads, setUploads] = useState<{ id: number; key: RowKey; field: string }[]>([])
  const uploadId = useRef(0)
  const [fillTarget, setFillTarget] = useState<CellRange | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  // The edited cell whose previous value is shown (hovering or tapping its dot).
  const [peek, setPeek] = useState<Pos | null>(null)
  const editId = useRef(0)

  // ---- geometry ---------------------------------------------------------

  const lefts = useMemo(() => {
    const result = [0]
    for (const column of columns) result.push(result[result.length - 1]! + (widths[column.field] ?? column.width))
    return result
  }, [columns, widths])
  const totalWidth = lefts[lefts.length - 1]!
  // Pinned columns come first and stay beside the row numbers while scrolling sideways.
  const pinnedCount = columns.findIndex(column => !column.pinned) < 0 ? columns.length : columns.findIndex(column => !column.pinned)
  const pinnedWidth = lefts[pinnedCount]!

  const maxRow = Math.max(0, rowCount - 1)
  const maxCol = Math.max(0, columns.length - 1)
  const clampSelection = (selection: Selection): Selection => ({
    anchor: { r: clamp(selection.anchor.r, 0, maxRow), c: clamp(selection.anchor.c, 0, maxCol) },
    focus: { r: clamp(selection.focus.r, 0, maxRow), c: clamp(selection.focus.c, 0, maxCol) },
  })
  const clamped = selections.map(clampSelection)
  // No selection after clicking blank space; keyboard navigation starts again from the first cell.
  const hasSelection = clamped.length > 0
  const sel = clamped[clamped.length - 1] ?? { anchor: { r: 0, c: 0 }, focus: { r: 0, c: 0 } }
  const range = toRange(sel)
  const ranges = clamped.map(toRange)
  const cellCount = ranges.reduce((sum, r) => sum + (r.rowEnd - r.rowStart + 1) * (r.colEnd - r.colStart + 1), 0)
  const rangeKey = JSON.stringify(ranges)
  useEffect(() => { onSelectionChange(ranges) }, [rangeKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const inSelection = (pos: Pos) => ranges.some(r => inRange(r, pos))

  const firstRow = Math.max(0, Math.floor(viewport.top / rowHeight) - OVERSCAN_ROWS)
  const lastRow = Math.min(rowCount - 1, Math.ceil((viewport.top + viewport.height) / rowHeight) + OVERSCAN_ROWS)
  const visibleColumns: number[] = []
  for (let c = 0; c < columns.length; c++) {
    if (c < pinnedCount || (GUTTER + lefts[c + 1]! >= viewport.left - OVERSCAN_PX && GUTTER + lefts[c]! <= viewport.left + viewport.width + OVERSCAN_PX)) visibleColumns.push(c)
  }

  useLayoutEffect(() => {
    const element = scroller.current!
    const measure = () => setViewport(current => ({ ...current, width: element.clientWidth, height: element.clientHeight }))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const frame = useRef(0)
  const onScroll = () => {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      const element = scroller.current
      if (element) setViewport(current => ({ ...current, top: element.scrollTop, left: element.scrollLeft }))
    })
    setMenu(null)
    setPeek(null)
  }

  /** Cell under a pointer, in view coordinates; null over the headers. */
  const posAt = useCallback((clientX: number, clientY: number, clampToGrid = false): Pos | null => {
    const element = scroller.current!
    const rect = element.getBoundingClientRect()
    const onScreen = clientX - rect.left - GUTTER
    // Over the pinned columns the position is on screen, elsewhere in the scrolled content.
    const x = onScreen >= 0 && onScreen < pinnedWidth ? onScreen : onScreen + element.scrollLeft
    const y = clientY - rect.top + element.scrollTop - HEADER_HEIGHT
    if (!clampToGrid && (onScreen < 0 || y < 0)) return null
    let c = 0
    while (c < columns.length - 1 && lefts[c + 1]! <= x) c++
    return { r: clamp(Math.floor(y / rowHeight), 0, maxRow), c: clamp(c, 0, maxCol) }
  }, [columns.length, lefts, rowHeight, maxRow, maxCol, HEADER_HEIGHT, pinnedWidth])

  const scrollToCell = useCallback((pos: Pos) => {
    const element = scroller.current
    if (!element) return
    const top = pos.r * rowHeight, bottom = top + rowHeight
    const viewHeight = element.clientHeight - HEADER_HEIGHT
    if (top < element.scrollTop) element.scrollTop = top
    else if (bottom > element.scrollTop + viewHeight) element.scrollTop = bottom - viewHeight
    if (pos.c < pinnedCount) return
    // Unpinned columns are visible between the pinned columns and the right edge.
    const left = lefts[pos.c] ?? 0, right = lefts[pos.c + 1] ?? left
    const viewWidth = element.clientWidth - GUTTER
    if (left - pinnedWidth < element.scrollLeft) element.scrollLeft = left - pinnedWidth
    else if (right > element.scrollLeft + viewWidth) element.scrollLeft = Math.min(left - pinnedWidth, right - viewWidth)
  }, [lefts, rowHeight, HEADER_HEIGHT, pinnedCount, pinnedWidth])

  const select = useCallback((next: Selection, scroll = true) => {
    setSelection(next)
    if (scroll) scrollToCell(next.focus)
  }, [scrollToCell])

  useEffect(() => {
    handleRef?.({ selectCell: pos => select({ anchor: pos, focus: pos }), focus: () => focusGrid() })
  }, [handleRef, select])

  // ---- editing ----------------------------------------------------------

  const focusGrid = () => sink.current?.focus({ preventScroll: true })

  function report(result: EditResult) {
    if (result.errors.length) {
      const first = result.errors[0]!
      onNotice(result.errors.length === 1 ? first.message : `${m.skipped(result.errors.length)} (${first.message})`)
    }
  }

  function startEditing(pos: Pos, initialText?: string) {
    const key = table.getRowKey(pos.r)
    const column = columns[pos.c]
    if (key === undefined || !column) return
    if (!table.canEdit(key, column.field)) {
      onNotice(m.readOnlyCell)
      return
    }
    if (!editorFor(column)) {
      if (initialText === undefined) toggleCheckbox()
      return
    }
    scrollToCell(pos)
    setEditing({ id: ++editId.current, r: pos.r, c: pos.c, key, field: column.field, ...(initialText === undefined ? {} : { initialText }) })
  }

  function toggleCheckbox() {
    // Set every selected checkbox to the opposite of the active cell.
    const active = table.getRowKey(sel.anchor.r)
    const column = columns[sel.anchor.c]
    if (active === undefined || !column || !isBuiltin(column, 'checkbox')) return
    const next = table.getCell(active, column.field).value !== true
    const updates: { row: RowKey; field: string; value: unknown }[] = []
    for (const target of ranges)
      for (let r = target.rowStart; r <= target.rowEnd; r++)
        for (let c = target.colStart; c <= target.colEnd; c++)
          if (isBuiltin(columns[c]!, 'checkbox')) updates.push({ row: table.getRowKey(r)!, field: columns[c]!.field, value: next })
    report(table.setCells(updates))
  }

  const pendingMove = useRef<Pos | null>(null)
  // ⌘/Ctrl held while committing (⌘Enter, ⌘+click an option) applies the value to every selected cell.
  const modDown = useRef(false)
  const [modHeld, setModHeld] = useState(false)
  const multiEdit = editing !== null && cellCount > 1
  useEffect(() => {
    if (!multiEdit) return
    const track = (event: KeyboardEvent | MouseEvent) => {
      modDown.current = event.metaKey || event.ctrlKey
      setModHeld(modDown.current)
    }
    const release = () => { modDown.current = false; setModHeld(false) }
    window.addEventListener('keydown', track, true)
    window.addEventListener('keyup', track, true)
    window.addEventListener('mousedown', track, true)
    window.addEventListener('blur', release)
    return () => {
      window.removeEventListener('keydown', track, true)
      window.removeEventListener('keyup', track, true)
      window.removeEventListener('mousedown', track, true)
      window.removeEventListener('blur', release)
      release()
    }
  }, [multiEdit])

  function finishEditing(id: number, value?: unknown, commit = false) {
    const editing = editingRef.current
    if (!editing || editing.id !== id) return
    setEditing(null)
    if (commit) {
      const toAll = cellCount > 1 && modDown.current
      report(toAll ? table.setValue(ranges, value, editing.field) : table.setCell(editing.key, editing.field, value))
      // Like Excel, ⌘Enter keeps the selection where it is.
      if (toAll) pendingMove.current = null
    }
    const move = pendingMove.current
    pendingMove.current = null
    if (move) {
      const pos = { r: clamp(editing.r + move.r, 0, maxRow), c: clamp(editing.c + move.c, 0, maxCol) }
      select({ anchor: pos, focus: pos })
    }
  }

  // Let the table (and code using it) commit the open editor and select cells.
  const bridge = useRef<{ commit(): boolean; select(ranges: CellRange[]): void }>({ commit: () => true, select: () => {} })
  bridge.current = {
    commit() {
      const open = editingRef.current
      if (!open) return true
      const draft = draftRef.current
      if (draft && 'error' in draft) { onNotice(draft.error); return false }
      if (draft) finishEditing(open.id, draft.value, true)
      else finishEditing(open.id)
      return true
    },
    select(next) {
      if (!next.length) return
      setSelections(next.map(range => ({ anchor: { r: range.rowStart, c: range.colStart }, focus: { r: range.rowEnd, c: range.colEnd } })))
      scrollToCell({ r: next[next.length - 1]!.rowStart, c: next[next.length - 1]!.colStart })
    },
  }
  useEffect(() => table.attachUI({
    commitEdit: () => bridge.current.commit(),
    isEditing: () => editingRef.current !== null,
    select: target => bridge.current.select(Array.isArray(target) ? [...target] as CellRange[] : [target as CellRange]),
  }), [table])

  const wasEditing = useRef(false)
  useEffect(() => {
    if (wasEditing.current && !editing) focusGrid()
    wasEditing.current = editing !== null
  }, [editing])

  // ---- keyboard ---------------------------------------------------------

  function move(delta: Pos, extend: boolean, toEdge: boolean) {
    const from = extend ? sel.focus : sel.anchor
    const focus = toEdge
      ? { r: delta.r ? (delta.r > 0 ? maxRow : 0) : from.r, c: delta.c ? (delta.c > 0 ? maxCol : 0) : from.c }
      : { r: clamp(from.r + delta.r, 0, maxRow), c: clamp(from.c + delta.c, 0, maxCol) }
    if (extend) {
      // Shift extends the active range and keeps the others.
      setLastSelection({ anchor: sel.anchor, focus })
      scrollToCell(focus)
    } else select({ anchor: focus, focus })
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.nativeEvent.isComposing || event.key === 'Process') return
    const mod = event.metaKey || event.ctrlKey
    const pageRows = Math.max(1, Math.floor((viewport.height - HEADER_HEIGHT) / rowHeight) - 1)
    const handled = () => event.preventDefault()
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
    if (mod && key === 'z') { handled(); if (event.shiftKey) table.redo(); else table.undo(); return }
    if (mod && key === 'y') { handled(); table.redo(); return }
    if (mod && key === 'a') { handled(); select({ anchor: { r: 0, c: 0 }, focus: { r: maxRow, c: maxCol } }, false); return }
    if (mod && key === 's') { handled(); onSave(); return }
    if (mod && key === 'e') { handled(); if (rowCount) onBulkEdit(ranges); return }
    if (mod && key === 'd') {
      handled()
      report(table.fill({ ...range, rowEnd: range.rowStart }, range))
      return
    }
    switch (event.key) {
      case 'ArrowUp': handled(); move({ r: -1, c: 0 }, event.shiftKey, mod); return
      case 'ArrowDown': handled(); move({ r: 1, c: 0 }, event.shiftKey, mod); return
      case 'ArrowLeft': handled(); move({ r: 0, c: -1 }, event.shiftKey, mod); return
      case 'ArrowRight': handled(); move({ r: 0, c: 1 }, event.shiftKey, mod); return
      case 'PageUp': handled(); move({ r: -pageRows, c: 0 }, event.shiftKey, false); return
      case 'PageDown': handled(); move({ r: pageRows, c: 0 }, event.shiftKey, false); return
      case 'Home': handled(); move(mod ? { r: -1, c: -1 } : { r: 0, c: -1 }, event.shiftKey, true); return
      case 'End': handled(); move(mod ? { r: 1, c: 1 } : { r: 0, c: 1 }, event.shiftKey, true); return
      case 'Tab': handled(); move({ r: 0, c: event.shiftKey ? -1 : 1 }, false, false); return
      case 'Enter':
        handled()
        if (event.shiftKey) move({ r: -1, c: 0 }, false, false)
        else if (rowCount && hasSelection) startEditing(sel.anchor)
        return
      case 'F2': handled(); if (rowCount && hasSelection) startEditing(sel.anchor); return
      case 'Escape': handled(); setMenu(null); select({ anchor: sel.anchor, focus: sel.anchor }, false); return
      case 'Delete': case 'Backspace': handled(); report(table.clear(ranges)); return
      case ' ':
        if (columns[sel.anchor.c] && isBuiltin(columns[sel.anchor.c]!, 'checkbox')) { handled(); toggleCheckbox(); return }
    }
    // Printable keys fall through to the hidden textarea; its input event opens the editor.
  }

  /** Typed text (including finished IME composition) opens the editor with that text. */
  function onSinkInput(event: React.FormEvent<HTMLTextAreaElement>) {
    if ((event.nativeEvent as InputEvent).isComposing) return
    const text = event.currentTarget.value
    event.currentTarget.value = ''
    if (text && rowCount && hasSelection) startEditing(sel.anchor, text)
  }

  // ---- clipboard --------------------------------------------------------

  function onCopy(event: React.ClipboardEvent) {
    event.preventDefault()
    event.clipboardData.setData('text/plain', table.copy(ranges))
    if (!table.canCopyAll(ranges)) onNotice(m.copiedLastRange)
  }

  function onCut(event: React.ClipboardEvent) {
    onCopy(event)
    report(table.clear(ranges))
  }

  function pasteText(text: string) {
    if (ranges.length > 1) {
      report(table.paste(ranges, text))
      return
    }
    const lines = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n')
    const result = table.paste(range, text)
    report(result)
    // Select what was pasted (a block pasted into a larger selection fills the selection).
    const height = lines.length, width = Math.max(...lines.map(line => line.split('\t').length))
    const selectedHeight = range.rowEnd - range.rowStart + 1, selectedWidth = range.colEnd - range.colStart + 1
    const tiled = selectedHeight % height === 0 && selectedWidth % width === 0
    const focus = {
      r: Math.min(table.getRowCount() - 1, range.rowStart + (tiled ? selectedHeight : height) - 1),
      c: Math.min(maxCol, range.colStart + (tiled ? selectedWidth : width) - 1),
    }
    select({ anchor: { r: range.rowStart, c: range.colStart }, focus }, false)
  }

  function onPaste(event: React.ClipboardEvent) {
    event.preventDefault()
    // Pasted files (e.g. a copied image) go to a cell whose type accepts them.
    const key = table.getRowKey(sel.anchor.r)
    const column = columns[sel.anchor.c]
    const files = [...event.clipboardData.files]
    if (files.length && key !== undefined && column?.type.files) { receiveFiles(key, column, files); return }
    pasteText(event.clipboardData.getData('text/plain'))
  }

  // ---- files --------------------------------------------------------------

  /** The cell under a file drag, if its type accepts the dragged files. */
  function fileDropTarget(event: React.DragEvent) {
    if (![...event.dataTransfer.types].includes('Files')) return null
    const pos = posAt(event.clientX, event.clientY)
    const column = pos && columns[pos.c]
    const handler = column?.type.files
    const key = pos ? table.getRowKey(pos.r) : undefined
    if (!pos || !column || !handler || key === undefined || !table.canEdit(key, column.field)) return null
    // During a drag only MIME types are visible; an empty type list is allowed and checked on drop.
    const items = [...event.dataTransfer.items].filter(item => item.kind === 'file')
    if (items.length && !items.some(item => !item.type || acceptsFile(handler.accept, item.type))) return null
    return { pos, column, key }
  }

  function receiveFiles(key: RowKey, column: ResolvedColumn, files: File[]) {
    const handler = column.type.files
    if (!handler) return
    const accepted = files.filter(file => acceptsFile(handler.accept, file.type, file.name))
    if (!accepted.length) { onNotice(m.notAccepted(column.title)); return }
    if (!table.canEdit(key, column.field)) { onNotice(m.readOnlyCell); return }
    const id = ++uploadId.current
    setUploads(current => [...current, { id, key, field: column.field }])
    handler.receive(accepted, column.options)
      .then(apply => {
        // Apply to the cell as it is now, not as it was when the upload started.
        const current = table.getCell(key, column.field).value
        const next = apply(column.type.isEmpty(current) ? null : current)
        if (isParseError(next)) onNotice(`${column.title}: ${next.error}`)
        else report(table.setCell(key, column.field, next))
      }, failure => onNotice(m.uploadFailed(failure instanceof Error ? failure.message : String(failure))))
      .finally(() => setUploads(current => current.filter(entry => entry.id !== id)))
  }

  // ---- pointer ----------------------------------------------------------

  function dragSelect(start: Selection, mode: 'cells' | 'rows' | 'columns') {
    const onMove = (event: MouseEvent) => {
      autoScroll(event)
      const pos = posAt(event.clientX, event.clientY, true)
      if (!pos) return
      const focus = mode === 'rows' ? { r: pos.r, c: maxCol } : mode === 'columns' ? { r: maxRow, c: pos.c } : pos
      setLastSelection({ anchor: start.anchor, focus })
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function autoScroll(event: MouseEvent) {
    const element = scroller.current!
    const rect = element.getBoundingClientRect()
    if (event.clientY > rect.bottom - 24) element.scrollTop += 24
    else if (event.clientY < rect.top + HEADER_HEIGHT + 8) element.scrollTop -= 24
    if (event.clientX > rect.right - 24) element.scrollLeft += 24
    else if (event.clientX < rect.left + GUTTER + 8) element.scrollLeft -= 24
  }

  function onBodyMouseDown(event: React.MouseEvent) {
    if ((event.target as HTMLElement).closest('.cw-editor')) return
    // Clicking away commits only the edited cell, even with ⌘/Ctrl held to add a range.
    modDown.current = false
    setMenu(null)
    const pos = posAt(event.clientX, event.clientY)
    if (!pos || !rowCount) return
    if (event.button === 2) {
      if (!inSelection(pos)) select({ anchor: pos, focus: pos }, false)
      return
    }
    event.preventDefault()
    focusGrid()
    // Tapping the dot of an edited cell shows its previous value (touch screens have no hover).
    const dot = (event.target as HTMLElement).closest('.cw-dirty-dot')
    setPeek(dot ? pos : null)
    // The ▾ of a select cell opens its options; the rest of the cell selects as usual.
    if ((event.target as HTMLElement).closest('.cw-dropdown-arrow') && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
      select({ anchor: pos, focus: pos }, false)
      startEditing(pos)
      return
    }
    if ((event.target as HTMLElement).closest('.cw-check') && !event.shiftKey) {
      // Clicking a checkbox toggles it directly.
      select({ anchor: pos, focus: pos }, false)
      const key = table.getRowKey(pos.r)!, field = columns[pos.c]!.field
      if (table.canEdit(key, field)) report(table.setCell(key, field, table.getCell(key, field).value !== true))
      else onNotice(m.readOnlyCell)
      return
    }
    // Columns with `clickToEdit` open their editor on a plain click.
    const clicked = columns[pos.c]
    if (clicked?.clickToEdit && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const key = table.getRowKey(pos.r)
      if (key !== undefined && table.canEdit(key, clicked.field)) {
        select({ anchor: pos, focus: pos }, false)
        startEditing(pos)
        return
      }
    }
    const next = event.shiftKey ? { anchor: sel.anchor, focus: pos } : { anchor: pos, focus: pos }
    if (event.shiftKey) setLastSelection(next)
    else if (event.metaKey || event.ctrlKey) setSelections(list => [...list, next])
    else setSelection(next)
    dragSelect(next, 'cells')
  }

  function onRowHeaderMouseDown(event: React.MouseEvent, r: number) {
    event.preventDefault()
    event.stopPropagation()
    focusGrid()
    setMenu(null)
    if (event.button === 2 && ranges.some(entry => r >= entry.rowStart && r <= entry.rowEnd)) return
    const next = { anchor: { r: event.shiftKey ? sel.anchor.r : r, c: 0 }, focus: { r, c: maxCol } }
    if (event.shiftKey) setLastSelection(next)
    else if (event.metaKey || event.ctrlKey) setSelections(list => [...list, next])
    else setSelection(next)
    if (event.button === 0) dragSelect(next, 'rows')
  }

  function onColumnHeaderMouseDown(event: React.MouseEvent, c: number) {
    if ((event.target as HTMLElement).closest('.cw-resize, .cw-sort, .cw-header-action')) return
    event.preventDefault()
    focusGrid()
    const next = { anchor: { r: 0, c: event.shiftKey ? sel.anchor.c : c }, focus: { r: maxRow, c } }
    if (event.shiftKey) setLastSelection(next)
    else if (event.metaKey || event.ctrlKey) setSelections(list => [...list, next])
    else setSelection(next)
    dragSelect(next, 'columns')
  }

  function startResize(event: React.MouseEvent, column: ResolvedColumn) {
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startWidth = widths[column.field] ?? column.width
    const onMove = (move: MouseEvent) => setWidths(current => ({ ...current, [column.field]: Math.max(column.minWidth, startWidth + move.clientX - startX) }))
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function cycleSort(column: ResolvedColumn, additive: boolean) {
    const current = sorts.find(entry => entry.field === column.field)
    const next = !current ? 'asc' : current.direction === 'asc' ? 'desc' : null
    if (!additive) {
      table.setSort(next ? [{ field: column.field, direction: next }] : [])
      return
    }
    // Keep the other sorts; this column cycles ascending → descending → off in its place.
    if (!current) table.setSort([...sorts, { field: column.field, direction: 'asc' }])
    else table.setSort(next ? sorts.map(entry => entry.field === column.field ? { ...entry, direction: next } : entry) : sorts.filter(entry => entry !== current))
  }

  function startFill(event: React.MouseEvent) {
    event.preventDefault()
    event.stopPropagation()
    const source = range
    let target: CellRange | null = null
    const onMove = (move: MouseEvent) => {
      autoScroll(move)
      const pos = posAt(move.clientX, move.clientY, true)
      if (!pos) return
      const down = pos.r - source.rowEnd, up = source.rowStart - pos.r
      const right = pos.c - source.colEnd, left = source.colStart - pos.c
      const vertical = Math.max(down, up), horizontal = Math.max(right, left)
      if (vertical <= 0 && horizontal <= 0) target = null
      else if (vertical >= horizontal) target = down > 0 ? { ...source, rowEnd: pos.r } : { ...source, rowStart: pos.r }
      else target = right > 0 ? { ...source, colEnd: pos.c } : { ...source, colStart: pos.c }
      setFillTarget(target)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setFillTarget(null)
      if (!target) return
      report(table.fill(source, target))
      select({ anchor: { r: target.rowStart, c: target.colStart }, focus: { r: target.rowEnd, c: target.colEnd } }, false)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // ---- context menu -----------------------------------------------------

  /** Rows touched by any selected range, top to bottom. */
  const selectedRows = () => {
    const rowsSelected = new Set<number>()
    for (const entry of ranges) for (let r = entry.rowStart; r <= entry.rowEnd; r++) rowsSelected.add(r)
    return [...rowsSelected].sort((a, b) => a - b)
  }
  const selectedKeys = () => selectedRows().map(r => table.getRowKey(r)!).filter(key => key !== undefined)
  const selectedRowCount = selectedRows().length

  function insertRow(where: 'above' | 'below' | 'end') {
    const anchor = table.getRowKey(where === 'above' ? range.rowStart : range.rowEnd)
    const key = where === 'end' || anchor === undefined ? table.insertRow() : table.insertRow(where === 'above' ? { before: anchor } : { after: anchor })
    const r = key === undefined ? undefined : table.getRowIndex(key)
    if (r !== undefined) select({ anchor: { r, c: 0 }, focus: { r, c: 0 } })
  }

  /** Quick edits from the field types of the selected columns, applied to their selected cells. */
  function quickMenu(): MenuItem[] {
    if (!menu || table.isReadOnly()) return []
    const columnIndexes = [...new Set(ranges.flatMap(entry => Array.from({ length: entry.colEnd - entry.colStart + 1 }, (_, i) => entry.colStart + i)))].sort((a, b) => a - b)
    const sections = columnIndexes.flatMap(c => {
      const column = columns[c]!
      if (column.alwaysReadOnly) return []
      const actions = column.type.quickActions(column.options)
      if (!actions.length) return []
      // Current values decide the check marks; very large selections skip them.
      const values: unknown[] = []
      let count = 0
      for (const entry of ranges) {
        if (c < entry.colStart || c > entry.colEnd) continue
        count += entry.rowEnd - entry.rowStart + 1
        for (let r = entry.rowStart; r <= entry.rowEnd && values.length <= 5000; r++) {
          const value = table.getCell(table.getRowKey(r)!, column.field).value
          values.push(column.type.isEmpty(value) ? null : value)
        }
      }
      const checkable = values.length > 0 && values.length <= 5000
      const toItem = (action: QuickAction<unknown, unknown>): MenuItem => ({
        label: action.label,
        ...(action.preview !== undefined ? { preview: renderCell(column, action.preview) } : {}),
        checked: checkable && action.isActive ? values.every(value => action.isActive!(value, column.options)) : false,
        ...(action.items ? { items: action.items.map(toItem) } : {}),
        ...(action.apply ? { run: () => report(table.updateCells(ranges, column.field, value => action.apply!(value, column.options))) } : {}),
      })
      return [{ column, count, items: actions.map(toItem) }]
    })
    if (!sections.length) return []
    if (sections.length === 1) {
      const [{ column, count, items }] = sections as [typeof sections[0]]
      return [{ label: m.cellsIn(column.title, count), header: true }, ...items, { label: '', separator: true }]
    }
    return [
      { label: m.quickEdit, header: true },
      ...sections.map(({ column, items }) => ({ label: column.title, items })),
      { label: '', separator: true },
    ]
  }

  /** Conflicting cells in the selection (bounded, for the menu). */
  function selectedConflicts() {
    const found: { theirs: unknown; column: ResolvedColumn }[] = []
    for (const entry of ranges) {
      for (let r = entry.rowStart; r <= entry.rowEnd && found.length < 5000; r++) {
        const key = table.getRowKey(r)
        if (key === undefined) continue
        for (let c = entry.colStart; c <= entry.colEnd; c++) {
          const conflict = table.getCell(key, columns[c]!.field).conflict
          if (conflict) found.push({ theirs: conflict.theirs, column: columns[c]! })
        }
      }
    }
    return found
  }
  const conflictsHere = menu ? selectedConflicts() : []
  const formatValue = (column: ResolvedColumn, value: unknown) => column.type.isEmpty(value) ? m.emptyValue : column.type.format(value, column.options)
  const deletableKeys = () => selectedKeys().filter(key => table.canDeleteRow(key))
  const deletableCount = menu ? deletableKeys().length : 0

  const menuItems: MenuItem[] = [
    ...(conflictsHere.length ? [
      { label: m.conflicts(conflictsHere.length), header: true },
      { label: m.useTheirs(conflictsHere.length === 1 ? formatValue(conflictsHere[0]!.column, conflictsHere[0]!.theirs) : ''), run: () => { table.resolveConflicts(ranges, 'theirs') } },
      { label: m.keepMine, run: () => { table.resolveConflicts(ranges, 'mine') } },
      { label: '', separator: true },
    ] : []),
    ...quickMenu(),
    ...(cellCount > 1 ? [{ label: `${m.editCells(cellCount)}…`, shortcut: shortcut('E'), run: () => onBulkEdit(ranges) }] : []),
    { label: m.copy, shortcut: shortcut('C'), run: () => { void navigator.clipboard?.writeText(table.copy(ranges)) } },
    {
      label: m.paste, shortcut: shortcut('V'),
      run: () => {
        navigator.clipboard?.readText().then(pasteText, () => onNotice(m.pasteHint(shortcut('V'))))
      },
    },
    { label: m.clearCells, shortcut: 'Del', run: () => report(table.clear(ranges)) },
    { label: '', separator: true },
    ...(table.canInsertRows() ? [
      { label: m.insertAbove, run: () => insertRow('above') },
      { label: m.insertBelow, run: () => insertRow('below') },
      { label: m.duplicateRows(selectedRowCount), run: () => { table.duplicateRows(selectedKeys()) } },
    ] : []),
    ...(deletableCount > 0 ? [{
      label: m.deleteRows(deletableCount), danger: true,
      run: () => {
        const first = selectedRows()[0] ?? 0
        table.deleteRows(deletableKeys())
        const pos = { r: first, c: sel.anchor.c }
        select({ anchor: pos, focus: pos }, false)
      },
    }] : []),
  ]

  // Rows are memoized; route header clicks through a stable callback.
  const rowHeaderHandler = useRef(onRowHeaderMouseDown)
  rowHeaderHandler.current = onRowHeaderMouseDown
  const onRowHeader = useCallback((event: React.MouseEvent, r: number) => rowHeaderHandler.current(event, r), [])

  // ---- render -----------------------------------------------------------

  const bodyHeight = rowCount * rowHeight
  const rect = (r: CellRange) => {
    // Overlays for pinned cells follow the horizontal scroll and sit above the pinned columns.
    const pinned = r.colEnd < pinnedCount
    return {
      left: GUTTER + lefts[r.colStart]! + (pinned ? viewport.left : 0), top: r.rowStart * rowHeight,
      width: lefts[r.colEnd + 1]! - lefts[r.colStart]!, height: (r.rowEnd - r.rowStart + 1) * rowHeight,
      ...(pinned ? { zIndex: 4 } : {}),
    }
  }
  const visible = rowCount > 0 && columns.length > 0 && hasSelection
  const selectionRect = visible ? rect(range) : null
  const selectionRects = visible ? ranges.map(rect) : []
  const activeRect = visible ? rect({ rowStart: sel.anchor.r, rowEnd: sel.anchor.r, colStart: sel.anchor.c, colEnd: sel.anchor.c }) : null
  const editingColumn = editing ? columns[editing.c] : undefined
  const Editor = editingColumn ? editorFor(editingColumn) : null
  const editingRect = editing ? rect({ rowStart: editing.r, rowEnd: editing.r, colStart: editing.c, colEnd: editing.c }) : null

  function header(c: number, left: number) {
    const column = columns[c]!
    const index = sorts.findIndex(entry => entry.field === column.field)
    const sort = sorts[index]
    const label = sort ? m.sortState(column.title, sort.direction, sorts.length > 1 ? index + 1 : undefined) : `${column.title} ${m.sort}`
    return (
      <div key={column.field} className="cw-colhead" role="columnheader" aria-colindex={c + 1} data-column-key={column.field}
        aria-sort={sort ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}
        data-selected={ranges.some(entry => c >= entry.colStart && c <= entry.colEnd) || undefined}
        style={{ left, width: lefts[c + 1]! - lefts[c]! }}
        onMouseDown={event => onColumnHeaderMouseDown(event, c)}>
        {column.alwaysReadOnly && <LockIcon />}
        <span className="cw-colhead-title" title={column.alwaysReadOnly ? `${column.title} (${m.readOnly})` : column.title}>{column.title}</span>
        {column.headerAction && <span className="cw-header-action">{column.headerAction}</span>}
        {column.sortable && (
          // ⌘/Ctrl/Shift+click adds a secondary sort.
          <button type="button" tabIndex={-1} className="cw-sort" data-active={sort ? sort.direction : undefined}
            aria-label={label} title={label} onClick={event => cycleSort(column, event.metaKey || event.ctrlKey || event.shiftKey)}>
            {sort?.direction === 'desc' ? '↓' : '↑'}
            {sort && sorts.length > 1 && <span className="cw-sort-priority">{index + 1}</span>}
          </button>
        )}
        <div className="cw-resize" onMouseDown={event => startResize(event, column)} />
      </div>
    )
  }

  const rows: ReactNode[] = []
  for (let r = firstRow; r <= lastRow; r++) {
    const key = table.getRowKey(r)!
    // Selected columns of this row, as a compact key for memoized rows ("2-4,7").
    const selectedColumns = ranges.filter(entry => r >= entry.rowStart && r <= entry.rowEnd).map(entry => `${entry.colStart}-${entry.colEnd}`).join(',')
    rows.push(
      <GridRow key={String(key)} table={table} rowKey={key} index={r} row={table.getRow(key)} columns={columns} visibleColumns={visibleColumns}
        lefts={lefts} pinnedCount={pinnedCount} rowHeight={rowHeight} selected={selectedColumns !== ''} selectedColumns={selectedColumns}
        saveError={table.getRowSaveError(key)} isNew={table.isNewRow(key)} changed={table.isRowChanged(key)} tableReadOnly={table.isReadOnly()}
        conflicts={table.getRowConflicts(key).join(',')}
        onHeaderMouseDown={onRowHeader} />,
    )
  }

  return (
    <MessagesContext.Provider value={messages}>
    <div className="cw-grid" onKeyDown={onKeyDown}
      // A file dropped anywhere else in the grid must not make the browser open it and leave the page.
      onDragOver={event => {
        if (event.defaultPrevented || ![...event.dataTransfer.types].includes('Files')) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'none'
      }}
      onDrop={event => { if ([...event.dataTransfer.types].includes('Files')) event.preventDefault() }}>
      <div className="cw-scroller" ref={scroller} onScroll={onScroll}
        // The scrolling element is the grid: it holds the header, rows and the open editor.
        role="grid" aria-label={ariaLabel} aria-multiselectable="true"
        aria-rowcount={rowCount + 1} aria-colcount={columns.length} aria-busy={loading || undefined}
        onMouseDown={event => {
          // Blank space around the rows clears the selection.
          if (event.target !== event.currentTarget && !(event.target as HTMLElement).classList.contains('cw-canvas')) return
          if (editingRef.current) bridge.current.commit()
          setSelections([])
          setMenu(null)
          focusGrid()
        }}>
        <div className="cw-canvas" style={{ width: GUTTER + totalWidth + EDGE_ROOM, height: HEADER_HEIGHT + bodyHeight + EDGE_ROOM }}>
          <div className="cw-header" role="row" aria-rowindex={1} style={{ height: HEADER_HEIGHT, width: GUTTER + totalWidth }}>
            <div className="cw-corner" style={{ width: GUTTER }}
              onMouseDown={event => { event.preventDefault(); focusGrid(); select({ anchor: { r: 0, c: 0 }, focus: { r: maxRow, c: maxCol } }, false) }} />
            {pinnedCount > 0 && (
              <div className="cw-pinned" style={{ left: GUTTER, width: pinnedWidth }}>
                {visibleColumns.filter(c => c < pinnedCount).map(c => header(c, lefts[c]!))}
              </div>
            )}
            {visibleColumns.filter(c => c >= pinnedCount).map(c => header(c, GUTTER + lefts[c]!))}
          </div>
          <div className="cw-body" style={{ height: bodyHeight }} onMouseDown={onBodyMouseDown}
            onMouseOver={event => {
              if (!(event.target as HTMLElement).closest('.cw-dirty-dot')) return
              const pos = posAt(event.clientX, event.clientY)
              if (pos && (pos.r !== peek?.r || pos.c !== peek?.c)) setPeek(pos)
            }}
            onMouseOut={event => {
              const from = (event.target as HTMLElement).closest('.cw-dirty-dot')
              if (from && !from.contains(event.relatedTarget as Node)) setPeek(null)
            }}
            onDragOver={event => {
              if ((event.target as HTMLElement).closest('.cw-editor')) return
              const target = fileDropTarget(event)
              if (!target) { setDropCell(null); return }
              event.preventDefault()
              event.dataTransfer.dropEffect = 'copy'
              if (dropCell?.r !== target.pos.r || dropCell?.c !== target.pos.c) setDropCell(target.pos)
            }}
            onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropCell(null) }}
            onDrop={event => {
              if ((event.target as HTMLElement).closest('.cw-editor')) return
              const target = fileDropTarget(event)
              setDropCell(null)
              if (!target) return
              event.preventDefault()
              select({ anchor: target.pos, focus: target.pos }, false)
              focusGrid()
              receiveFiles(target.key, target.column, [...event.dataTransfer.files])
            }}
            onDoubleClick={event => { const pos = posAt(event.clientX, event.clientY); if (pos && !editing) startEditing(pos) }}
            onContextMenu={event => {
              if ((event.target as HTMLElement).closest('.cw-editor')) return
              event.preventDefault()
              if (rowCount) setMenu({ x: event.clientX, y: event.clientY })
            }}>
            {rows}
            {selectionRects.map((style, index) => <div key={index} className="cw-selection" style={style} />)}
            {activeRect && !editing && <div className="cw-active" style={activeRect} />}
            {selectionRect && ranges.length === 1 && !editing && (
              <div className="cw-fill-handle" style={{
                // Centered on the selection's corner; the canvas keeps room for it at the last row and column.
                left: selectionRect.left + selectionRect.width,
                top: selectionRect.top + selectionRect.height,
                ...(selectionRect.zIndex ? { zIndex: selectionRect.zIndex + 1 } : {}),
              }}
                onMouseDown={startFill} />
            )}
            {fillTarget && <div className="cw-fill-preview" style={rect(fillTarget)} />}
            {peek && !editing && <OriginalPeek table={table} columns={columns} pos={peek} rect={rect({ rowStart: peek.r, rowEnd: peek.r, colStart: peek.c, colEnd: peek.c })} below={peek.r * rowHeight - viewport.top < 40} />}
            {dropCell && <div className="cw-drop-target" style={rect({ rowStart: dropCell.r, rowEnd: dropCell.r, colStart: dropCell.c, colEnd: dropCell.c })}><span>{m.dropToUpload}</span></div>}
            {uploads.map(upload => {
              const r = table.getRowIndex(upload.key)
              const c = columns.findIndex(column => column.field === upload.field)
              if (r === undefined || c < 0) return null
              return <div key={upload.id} className="cw-cell-busy" style={rect({ rowStart: r, rowEnd: r, colStart: c, colEnd: c })}><span className="cw-spinner" aria-label={messages.image.uploading} /></div>
            })}
            {editing && Editor && editingColumn && editingRect && (
              // Exactly the cell's box, so text stays where it was; popups open below it.
              <div className="cw-editor" style={{ left: editingRect.left, top: editingRect.top, width: editingRect.width, height: editingRect.height, ...(editingRect.zIndex ? { zIndex: 11 } : {}) }}
                onKeyDownCapture={event => {
                  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finishEditing(editing.id); return }
                  // A commit during this key event moves the selection; the move expires with the event.
                  modDown.current = event.metaKey || event.ctrlKey
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing) pendingMove.current = modDown.current ? null : { r: event.shiftKey ? -1 : 1, c: 0 }
                  else if (event.key === 'Tab') pendingMove.current = { r: 0, c: event.shiftKey ? -1 : 1 }
                  else return
                  queueMicrotask(() => { pendingMove.current = null })
                }}
                // Keys inside the editor never reach the grid's own shortcuts.
                onKeyDown={event => event.stopPropagation()}>
                {cellCount > 1 && (
                  <div className="cw-editor-badge" data-armed={modHeld || undefined} data-below={editingRect.top - viewport.top < 28 || undefined} role="status">
                    {modHeld ? m.applyingToAll(cellCount) : <ApplyHint text={m.applyToAll(shortcut('Enter'), cellCount)} shortcut={shortcut('Enter')} />}
                  </div>
                )}
                <Editor
                  key={editing.id}
                  column={editingColumn}
                  row={table.getRow(editing.key)}
                  value={table.getCell(editing.key, editing.field).value}
                  options={editingColumn.options}
                  {...(editing.initialText === undefined ? {} : { initialText: editing.initialText })}
                  onChange={value => { draftRef.current = { value } }}
                  onDraft={draft => { draftRef.current = draft }}
                  onCommit={value => finishEditing(editing.id, value, true)}
                  onCancel={() => { pendingMove.current = null; finishEditing(editing.id) }}
                />
              </div>
            )}
          </div>
        </div>
        {!rowCount && (
          <div className="cw-empty" role="status">
            {loading ? m.loading : table.getRows().length ? m.noMatchingRows : m.noRows}
          </div>
        )}
      </div>
      <textarea
        ref={sink}
        className="cw-sink"
        aria-label="Table cell input"
        style={activeRect ? { left: activeRect.left - viewport.left, top: HEADER_HEIGHT + activeRect.top - viewport.top } : undefined}
        onInput={onSinkInput}
        onCompositionEnd={event => {
          const text = event.currentTarget.value
          event.currentTarget.value = ''
          if (text && rowCount && hasSelection) startEditing(sel.anchor, text)
        }}
        onCopy={onCopy}
        onCut={onCut}
        onPaste={onPaste}
      />
      {menu && (
        <ContextMenu menu={menu} onClose={() => { setMenu(null); focusGrid() }} items={menuItems} />
      )}
    </div>
    </MessagesContext.Provider>
  )
}

interface MenuItem {
  label: string
  /** Rendered instead of the label, e.g. an option pill. */
  preview?: ReactNode
  shortcut?: string
  run?(): void
  items?: MenuItem[]
  checked?: boolean
  danger?: boolean
  disabled?: boolean
  header?: boolean
  separator?: boolean
}

function ContextMenu({ menu, items, onClose }: { menu: Menu; items: MenuItem[]; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: menu.x, top: menu.y })
  useLayoutEffect(() => {
    const element = ref.current!
    const { width, height } = element.getBoundingClientRect()
    setPosition({ left: Math.max(8, Math.min(menu.x, window.innerWidth - width - 8)), top: Math.max(8, Math.min(menu.y, window.innerHeight - height - 8)) })
    element.querySelector<HTMLButtonElement>('.cw-menu-item')?.focus()
  }, [menu])
  useEffect(() => {
    const close = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) onClose() }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [onClose])
  return (
    <div ref={ref} className="cw-menu-root" style={position}
      // Keys in the menu never reach the grid's shortcuts (Enter would start editing instead of clicking).
      onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') onClose() }}>
      <MenuList items={items} onClose={onClose} />
    </div>
  )
}

function MenuList({ items, onClose, onExit, nested }: { items: MenuItem[]; onClose(): void; onExit?(): void; nested?: boolean }) {
  const [open, setOpen] = useState<number | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const [flip, setFlip] = useState({ left: false, shift: 0 })

  useLayoutEffect(() => {
    if (!nested) return
    // Keep sub-menus on screen: open to the left near the right edge, and move up near the bottom.
    const rect = list.current!.getBoundingClientRect()
    setFlip({ left: rect.right > window.innerWidth - 8, shift: Math.max(0, rect.bottom - window.innerHeight + 8) })
  }, [nested])

  const buttons = () => [...list.current!.querySelectorAll<HTMLButtonElement>(':scope > .cw-menu-entry > .cw-menu-item')]
  function onKeyDown(event: React.KeyboardEvent) {
    const all = buttons()
    const index = all.indexOf(document.activeElement as HTMLButtonElement)
    if (index < 0) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      event.stopPropagation()
      all[(index + (event.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length]?.focus()
    } else if (event.key === 'ArrowLeft' && onExit) {
      event.preventDefault()
      event.stopPropagation()
      onExit()
    }
  }

  return (
    // Long option lists scroll; menus that open further sub-menus must not clip them.
    <div ref={list} className="cw-menu" role="menu" onKeyDown={onKeyDown} data-scroll={!items.some(item => item.items?.length) || undefined}
      style={nested ? { ...(flip.left ? { left: 'auto', right: '100%' } : {}), top: -5 - flip.shift } : undefined}>
      {items.map((item, index) => {
        if (item.separator) return <div key={index} className="cw-menu-separator" role="separator" />
        if (item.header) return <div key={index} className="cw-menu-header">{item.label}</div>
        const hasItems = !!item.items?.length
        return (
          <div key={index} className="cw-menu-entry" onMouseEnter={() => setOpen(hasItems ? index : null)}>
            <button type="button" role="menuitem" className="cw-menu-item" data-danger={item.danger || undefined} disabled={item.disabled}
              aria-haspopup={hasItems || undefined} aria-expanded={hasItems ? open === index : undefined} aria-checked={item.checked || undefined}
              onClick={() => {
                if (hasItems) { setOpen(index); return }
                onClose()
                item.run?.()
              }}
              onKeyDown={event => {
                if (hasItems && (event.key === 'ArrowRight' || event.key === 'Enter' || event.key === ' ')) {
                  event.preventDefault()
                  event.stopPropagation()
                  setOpen(index)
                  requestAnimationFrame(() => list.current?.querySelector<HTMLButtonElement>(`:scope > .cw-menu-entry:nth-child(${index + 1}) .cw-menu .cw-menu-item`)?.focus())
                }
              }}>
              <span className="cw-menu-check" aria-hidden="true">{item.checked ? '✓' : ''}</span>
              <span className="cw-menu-label">{item.preview ?? item.label}</span>
              {item.shortcut && <kbd>{item.shortcut}</kbd>}
              {hasItems && <span className="cw-menu-arrow" aria-hidden="true">›</span>}
            </button>
            {hasItems && open === index && (
              <MenuList items={item.items!} onClose={onClose} nested
                onExit={() => { setOpen(null); buttons()[items.slice(0, index).filter(entry => !entry.header && !entry.separator).length]?.focus() }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

interface GridRowProps {
  table: Table<any>
  rowKey: RowKey
  index: number
  row: unknown
  columns: readonly ResolvedColumn[]
  visibleColumns: number[]
  lefts: number[]
  pinnedCount: number
  rowHeight: number
  selected: boolean
  /** Selected column ranges in this row, e.g. "2-4,7". */
  selectedColumns: string
  saveError: string | undefined
  isNew: boolean
  changed: boolean
  /** A read-only table is not shaded cell by cell. */
  tableReadOnly: boolean
  /** Fields in conflict, so settling one re-renders the row. */
  conflicts: string
  onHeaderMouseDown(event: React.MouseEvent, r: number): void
}

const GridRow = memo(function GridRow({ table, rowKey, index, row, columns, visibleColumns, lefts, pinnedCount, rowHeight, selected, selectedColumns, saveError, isNew, changed, tableReadOnly, onHeaderMouseDown }: GridRowProps) {
  const spans = selectedColumns ? selectedColumns.split(',').map(span => span.split('-').map(Number) as [number, number]) : []
  const cell = (c: number, left: number) => {
    const column = columns[c]!
    const state = table.getCell(rowKey, column.field)
    return (
      <GridCell key={column.field} column={column} index={c} value={state.value} changed={state.changed && !isNew} error={state.error}
        conflict={state.conflict} selected={spans.some(([from, to]) => c >= from && c <= to)}
        hasOriginal={state.original !== undefined && !state.conflict}
        readOnly={tableReadOnly || table.canEdit(rowKey, column.field) ? false : column.alwaysReadOnly ? 'column' : 'row'}
        editable={!tableReadOnly && table.canEdit(rowKey, column.field)}
        left={left} width={lefts[c + 1]! - lefts[c]!} row={row} />
    )
  }
  return (
    <div className="cw-row" role="row" aria-rowindex={index + 2} style={{ top: index * rowHeight, height: rowHeight }} data-selected={selected || undefined}>
      <div className="cw-rowhead" style={{ width: GUTTER }} data-new={isNew || undefined} data-changed={changed || undefined}
        data-error={saveError ? true : undefined} title={saveError} onMouseDown={event => onHeaderMouseDown(event, index)}>
        {index + 1}
      </div>
      {pinnedCount > 0 && (
        <div className="cw-pinned" style={{ left: GUTTER, width: lefts[pinnedCount]! }}>
          {visibleColumns.filter(c => c < pinnedCount).map(c => cell(c, lefts[c]!))}
        </div>
      )}
      {visibleColumns.filter(c => c >= pinnedCount).map(c => cell(c, GUTTER + lefts[c]!))}
    </div>
  )
}, (a, b) => a.row === b.row && a.index === b.index && a.columns === b.columns && a.visibleColumns.join() === b.visibleColumns.join()
  && a.lefts === b.lefts && a.pinnedCount === b.pinnedCount && a.selected === b.selected && a.selectedColumns === b.selectedColumns && a.saveError === b.saveError && a.isNew === b.isNew && a.changed === b.changed
  && a.rowHeight === b.rowHeight && a.onHeaderMouseDown === b.onHeaderMouseDown && a.table === b.table && a.tableReadOnly === b.tableReadOnly
  && a.conflicts === b.conflicts)

interface GridCellProps {
  column: ResolvedColumn
  index: number
  value: unknown
  conflict: { theirs: unknown } | undefined
  /** Edited cell of a saved row: shows a dot that reveals the previous value. */
  hasOriginal: boolean
  selected: boolean
  changed: boolean
  error: string | undefined
  /** Read-only for the whole column, or only this row. */
  readOnly: false | 'column' | 'row'
  editable: boolean
  left: number
  width: number
  row: unknown
}

const GridCell = memo(function GridCell({ column, index, value, conflict, hasOriginal, selected, changed, error, readOnly, editable, left, width, row }: GridCellProps) {
  const messages = useMessages()
  // Option lists open from a ▾ button, so a plain click still selects the cell.
  const arrow = editable && (isBuiltin(column, 'select') || isBuiltin(column, 'multiSelect'))
  const theirs = conflict ? (column.type.isEmpty(conflict.theirs) ? messages.ui.emptyValue : column.type.format(conflict.theirs, column.options)) : ''
  return (
    <div className="cw-cell" role="gridcell" aria-colindex={index + 1} aria-selected={selected} aria-readonly={readOnly ? true : undefined}
      data-column-key={column.field} style={{ left, width, justifyContent: cellAlign(column) }}
      data-changed={changed || undefined} data-invalid={error ? true : undefined} data-readonly={readOnly || undefined}
      data-conflict={conflict ? true : undefined} data-has-arrow={arrow || undefined}
      title={conflict ? messages.ui.conflictTitle(theirs) : error ?? (readOnly ? messages.ui.readOnly : undefined)}>
      {column.render ? column.render(column.type.isEmpty(value) ? null : value, row) : renderCell(column, value)}
      {hasOriginal && <span className="cw-dirty-dot" aria-hidden="true" />}
      {arrow && (
        <button type="button" tabIndex={-1} className="cw-dropdown-arrow" aria-label={messages.ui.openOptions(column.title)}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      )}
    </div>
  )
})

/** The value an edited cell had before the unsaved edit, beside its dot. */
function OriginalPeek({ table, columns, pos, rect, below }: {
  table: Table<any>
  columns: readonly ResolvedColumn[]
  pos: Pos
  rect: { left: number; top: number; width: number; height: number; zIndex?: number }
  below: boolean
}) {
  const messages = table.getMessages()
  const key = table.getRowKey(pos.r)
  const column = columns[pos.c]
  const original = key === undefined || !column ? undefined : table.getCell(key, column.field).original
  if (!original || !column || key === undefined) return null
  const empty = column.type.isEmpty(original.value)
  const content = empty ? messages.ui.emptyValue
    : column.render ? column.render(original.value, table.getRow(key)) : renderCell(column, original.value)
  return (
    <div className="cw-original" role="tooltip" data-below={below || undefined}
      style={{ left: rect.left + rect.width, top: below ? rect.top + rect.height : rect.top, ...(rect.zIndex ? { zIndex: 12 } : {}) }}>
      <span className="cw-original-label">{messages.ui.originalValue}</span>
      <span className="cw-original-value">{content}</span>
    </div>
  )
}

/** The shortcut inside a hint, shown as a key. */
function ApplyHint({ text, shortcut: key }: { text: string; shortcut: string }) {
  const at = text.indexOf(key)
  if (at < 0) return <>{text}</>
  return <>{text.slice(0, at)}<kbd>{key}</kbd>{text.slice(at + key.length)}</>
}

function LockIcon() {
  return (
    <svg className="cw-lock" width="11" height="11" viewBox="0 0 16 16" aria-hidden="true">
      <path fill="currentColor" d="M4 7V5a4 4 0 1 1 8 0v2h.5A1.5 1.5 0 0 1 14 8.5v5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 13.5v-5A1.5 1.5 0 0 1 3.5 7H4Zm2 0h4V5a2 2 0 1 0-4 0v2Z" />
    </svg>
  )
}
