import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { QuickAction } from '../core/field-type.js'
import type { CellRange, EditResult, Table } from '../core/table.js'
import { renderCell } from './cells.js'

/** Where a menu opens, in viewport pixels. */
export interface Menu { x: number; y: number }

/**
 * Quick edits that the field types of the selected columns offer, applied to the selected
 * cells of each column. One column gives a titled list; several give a sub-menu per column.
 */
export function quickActionItems(table: Table<any>, ranges: readonly CellRange[], report: (result: EditResult) => void): MenuItem[] {
  const sections = quickActionColumns(table, ranges).map(c => {
    const column = table.getColumns()[c]!
    const actions = column.type.quickActions(column.options)
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
    return { column, count, items: actions.map(toItem) }
  })
  if (!sections.length) return []
  const m = table.getMessages().ui
  if (sections.length === 1) {
    const [{ column, count, items }] = sections as [typeof sections[0]]
    return [{ label: m.cellsIn(column.title, count), header: true }, ...items]
  }
  return [{ label: m.quickEdit, header: true }, ...sections.map(({ column, items }) => ({ label: column.title, items }))]
}

/** Indexes of the selected, editable columns whose field type has quick actions. Cheap: reads no cells. */
export function quickActionColumns(table: Table<any>, ranges: readonly CellRange[]): number[] {
  if (table.isReadOnly() || table.getRowCount() === 0) return []
  const columns = table.getColumns()
  const indexes = new Set<number>()
  for (const entry of ranges) for (let c = entry.colStart; c <= entry.colEnd; c++) indexes.add(c)
  return [...indexes].sort((a, b) => a - b).filter(c => {
    const column = columns[c]
    return column && !column.alwaysReadOnly && column.type.quickActions(column.options).length > 0
  })
}

export interface MenuItem {
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

export function ContextMenu({ menu, items, onClose, anchor }: {
  menu: Menu
  items: MenuItem[]
  onClose(): void
  /** Presses on this element (the button that toggles the menu) do not count as outside. */
  anchor?: React.RefObject<HTMLElement | null>
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: menu.x, top: menu.y })
  useLayoutEffect(() => {
    const element = ref.current!
    const { width, height } = element.getBoundingClientRect()
    setPosition({ left: Math.max(8, Math.min(menu.x, window.innerWidth - width - 8)), top: Math.max(8, Math.min(menu.y, window.innerHeight - height - 8)) })
    element.querySelector<HTMLButtonElement>('.cw-menu-item')?.focus()
  }, [menu])
  useEffect(() => {
    const close = (event: MouseEvent) => {
      const target = event.target as Node
      if (!ref.current?.contains(target) && !anchor?.current?.contains(target)) onClose()
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [onClose, anchor])
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
