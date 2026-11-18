import { describe, expect, it, vi } from 'vitest'
import { zhCN } from '../locales/zh-cn.js'
import { defineColumns } from './columns.js'
import { createTable } from './table.js'

type Stock = { id: string; name: string; available: number; held: number; status: string }

const columns = defineColumns<Stock>([
  { field: 'name', type: 'text' },
  { field: 'available', type: 'number', dependsOn: ['held'] },
  { field: 'status', type: 'select', options: ['active', 'inactive'] },
  { key: 'free', title: 'Free', type: 'number', value: row => row.available - row.held },
])

const source: Stock[] = [
  { id: 'a', name: 'Apple', available: 10, held: 0, status: 'active' },
  { id: 'b', name: 'Banana', available: 5, held: 1, status: 'active' },
]

const table = (options: Partial<Parameters<typeof createTable<Stock>>[0]> = {}) => createTable<Stock>({ data: source, columns, ...options })

describe('syncing newer source data', () => {
  it('takes source values for untouched fields and keeps unsaved edits', () => {
    const t = table()
    t.setCell('a', 'name', 'Green apple')
    t.syncData([{ ...source[0]!, available: 8 }, { ...source[1]!, name: 'Banana 2' }])
    expect(t.getRow('a')).toMatchObject({ name: 'Green apple', available: 8 })
    expect(t.getRow('b')?.name).toBe('Banana 2')
    expect(t.getChanges().updated).toEqual([expect.objectContaining({ id: 'a', changed: ['name'] })])
    expect(t.getStatus().conflictCells).toBe(0)
  })

  it('marks a conflict when the source changes a field with an unsaved edit, and blocks saving', async () => {
    const onSave = vi.fn()
    const t = table({ onSave })
    t.setCell('a', 'name', 'Mine')
    t.syncData([{ ...source[0]!, name: 'Theirs' }, source[1]!])
    expect(t.getCell('a', 'name')).toMatchObject({ value: 'Mine', changed: true, conflict: { theirs: 'Theirs' } })
    expect(await t.save()).toEqual({ status: 'conflict', cells: 1 })
    expect(onSave).not.toHaveBeenCalled()
    t.resolveConflict('a', 'name', 'mine')
    expect(await t.save()).toEqual({ status: 'saved', errors: 0 })
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ updated: [expect.objectContaining({ row: expect.objectContaining({ name: 'Mine' }) })] }))
  })

  it('resolving with the source value is undoable', () => {
    const t = table()
    t.setCell('a', 'name', 'Mine')
    t.syncData([{ ...source[0]!, name: 'Theirs' }, source[1]!])
    expect(t.resolveConflicts({ rowStart: 0, rowEnd: 1, colStart: 0, colEnd: 3 }, 'theirs')).toBe(1)
    expect(t.getCell('a', 'name')).toMatchObject({ value: 'Theirs', changed: false, conflict: undefined })
    t.undo()
    expect(t.getRow('a')?.name).toBe('Mine')
  })

  it('treats a change to a dependency as a conflict for the edited value', () => {
    const t = table()
    t.setCell('a', 'available', 7)
    // An order held one more unit while the edit was unsaved.
    t.syncData([{ ...source[0]!, held: 1 }, source[1]!])
    expect(t.getCell('a', 'available').conflict).toEqual({ theirs: 10 })
    expect(t.getRow('a')).toMatchObject({ available: 7, held: 1 })
  })

  it('no conflict when the source reaches the same value', () => {
    const t = table()
    t.setCell('a', 'name', 'Same')
    t.syncData([{ ...source[0]!, name: 'Same' }, source[1]!])
    expect(t.getCell('a', 'name')).toMatchObject({ changed: false, conflict: undefined })
    expect(t.getStatus().changedRows).toBe(0)
  })

  it('a user edit to a conflicting cell settles it', () => {
    const t = table()
    t.setCell('a', 'name', 'Mine')
    t.syncData([{ ...source[0]!, name: 'Theirs' }, source[1]!])
    t.setCell('a', 'name', 'Final')
    expect(t.getCell('a', 'name').conflict).toBeUndefined()
  })

  it('adds new source rows, removes vanished ones, and keeps unsaved new rows in place', () => {
    const t = table()
    const added = t.insertRow({ after: 'a', values: { name: 'Draft' } })!
    t.setCell('b', 'name', 'Edited')
    t.undo()
    t.redo()
    t.syncData([source[0]!, { id: 'c', name: 'Cherry', available: 1, held: 0, status: 'active' }])
    expect(t.getRows().map(row => row.name)).toEqual(['Apple', 'Draft', 'Cherry'])
    expect(t.isNewRow(added)).toBe(true)
    // History about a removed row is dropped instead of resurrecting it.
    t.undo(); t.undo()
    expect(t.getRows().map(row => row.name)).toEqual(['Apple', 'Cherry'])
  })

  it('matches a saved new row to its server id', async () => {
    const t = table({ onSave: changes => ({ created: changes.created.map(row => ({ ...row, id: 'n1' })) }) })
    const key = t.insertRow({ values: { name: 'New', available: 0, held: 0, status: 'active' } })!
    await t.save()
    t.syncData([...source, { id: 'n1', name: 'New (server)', available: 0, held: 0, status: 'active' }])
    expect(t.getRows()).toHaveLength(3)
    expect(t.getRow(key)?.name).toBe('New (server)')
    expect(t.getStatus().changedRows).toBe(0)
  })

  it('keeps a row deleted locally deleted', () => {
    const t = table()
    t.deleteRows(['b'])
    t.syncData([source[0]!, { ...source[1]!, name: 'Banana 2' }])
    expect(t.getRows().map(row => row.id)).toEqual(['a'])
    expect(t.getChanges().deleted).toEqual(['b'])
  })

  it('keeps the view still while syncing when sorted', () => {
    const t = table()
    t.setSort([{ field: 'name', direction: 'asc' }])
    t.syncData([{ ...source[0]!, name: 'Zucchini' }, source[1]!])
    expect([t.getRowKey(0), t.getRowKey(1)]).toEqual(['a', 'b'])
    t.refreshView()
    expect([t.getRowKey(0), t.getRowKey(1)]).toEqual(['b', 'a'])
  })
})

describe('computed columns', () => {
  it('are read-only, follow edits, and sort, filter and copy like other columns', () => {
    const t = table()
    expect(t.getCell('b', 'free')).toMatchObject({ value: 4, changed: false })
    expect(t.canEdit('b', 'free')).toBe(false)
    t.setCell('b', 'available', 20)
    expect(t.getCell('b', 'free').value).toBe(19)
    t.setSort([{ field: 'free', direction: 'desc' }])
    expect(t.getRowKey(0)).toBe('b')
    t.setFilters([{ field: 'free', operator: 'gt', value: 15 }])
    expect(t.getRowCount()).toBe(1)
    expect(t.copy({ rowStart: 0, rowEnd: 0, colStart: 1, colEnd: 3 })).toBe('20\tactive\t19')
    expect(t.setCellText('b', 'free', '1').errors[0]?.message).toBe('Read-only')
  })
})

describe('table options', () => {
  it('limits deletion with canDeleteRow', () => {
    const t = table({ canDeleteRow: (_row, { isNew }) => isNew })
    const added = t.insertRow()!
    expect(t.canDeleteRow('a')).toBe(false)
    expect(t.deleteRows(['a', added])).toBe(1)
    expect(t.getRows().map(row => row.id)).toEqual(['a', 'b'])
  })

  it('copies rows with duplicateRow', () => {
    const t = table({ duplicateRow: row => ({ ...row, id: undefined, name: `${row.name} (copy)` }) as Partial<Stock> })
    const [copy] = t.duplicateRows(['a'])
    expect(t.getRow(copy!)).toMatchObject({ name: 'Apple (copy)', available: 10 })
  })

  it('filters rows by predicate and finds them by extra search text', () => {
    const t = table({ searchText: row => row.id === 'b' ? 'yellow fruit' : '' })
    t.setRowFilter(row => row.available > 6)
    expect(t.getRowCount()).toBe(1)
    t.setRowFilter(null)
    t.setSearch('yellow')
    expect(t.getRowKey(0)).toBe('b')
  })

  it('discards every unsaved change as one undo step', () => {
    const t = table()
    t.setCell('a', 'name', 'X')
    t.deleteRows(['b'])
    t.insertRow({ values: { name: 'New' } })
    t.discardChanges()
    expect(t.getRows().map(row => row.name)).toEqual(['Apple', 'Banana'])
    expect(t.getStatus().changedRows).toBe(0)
    t.undo()
    expect(t.getStatus().changedRows).toBe(3)
  })

  it('commits the open editor before saving, and stops when it cannot', async () => {
    const onSave = vi.fn()
    const t = table({ onSave })
    let draft: string | null = 'Typed but not committed'
    t.attachUI({
      commitEdit() {
        if (draft === null) return false
        t.setCell('a', 'name', draft)
        return true
      },
      isEditing: () => true,
      select: () => {},
    })
    expect(await t.save()).toMatchObject({ status: 'saved' })
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ updated: [expect.objectContaining({ changed: ['name'] })] }))
    draft = null
    t.setCell('b', 'name', 'Other')
    expect(await t.save()).toEqual({ status: 'editing' })
  })

  it('speaks Chinese with zhCN messages', () => {
    const t = table({ messages: zhCN })
    expect(t.setCellText('a', 'available', 'abc').errors[0]?.message).toBe('不是有效数字')
    expect(t.setCellText('a', 'free', '1').errors[0]?.message).toBe('只读')
    const status = t.getColumn('status')!
    expect(status.type.quickActions(status.options)[0]?.label).toBe('设为')
  })
})

describe('free tags and pinned columns', () => {
  type Item = { id: number; name: string; tags: string[] }
  it('accepts new tags when allowCreate is set and keeps known ones in option order', () => {
    const t = createTable<Item>({
      data: [{ id: 1, name: 'A', tags: [] }],
      columns: [{ field: 'name', type: 'text' }, { field: 'tags', type: 'multiSelect', options: ['red', 'blue'], allowCreate: true }],
    })
    expect(t.setCellText(1, 'tags', 'blue, shiny / red').errors).toEqual([])
    expect(t.getRow(1)?.tags).toEqual(['blue', 'shiny', 'red'])
    expect(t.getCell(1, 'tags').error).toBeUndefined()
    const column = t.getColumn('tags')!
    const add = column.type.quickActions(column.options)[0]!.items![1]!
    t.updateCells({ rowStart: 0, rowEnd: 0, colStart: 1, colEnd: 1 }, 'tags', value => add.apply!(value, column.options))
    expect(t.getRow(1)?.tags).toEqual(['red', 'blue', 'shiny'])
  })

  it('shows pinned columns first', () => {
    const t = createTable<Item>({
      data: [],
      columns: [{ field: 'tags', type: 'multiSelect', options: [] }, { field: 'name', type: 'text', pinned: true }],
    })
    expect(t.getColumns().map(column => column.field)).toEqual(['name', 'tags'])
    expect(t.getColumnIndex('tags')).toBe(1)
  })
})

describe('the source after your own save', () => {
  type Stock = { id: string; onHand: number; reserved: number; available: number }
  const columns = defineColumns<Stock>([
    { field: 'reserved', type: 'number', dependsOn: ['onHand', 'available'] },
    { field: 'available', type: 'number', dependsOn: ['onHand', 'reserved'] },
  ])
  const start: Stock[] = [{ id: 'a', onHand: 10, reserved: 0, available: 10 }]

  it('takes server-derived fields from the next source version without conflicts, keeping later edits', async () => {
    const t = createTable<Stock>({ data: start, columns, onSave: () => {} })
    t.setCell('a', 'reserved', 3)
    await t.save()
    // Edited again before the source caught up with the save.
    t.setCell('a', 'available', 20)
    // The server derived available = 7 from the saved reservation.
    t.syncData([{ id: 'a', onHand: 10, reserved: 3, available: 7 }])
    expect(t.getStatus().conflictCells).toBe(0)
    expect(t.getRow('a')).toEqual({ id: 'a', onHand: 10, reserved: 3, available: 20 })
    expect(t.getChanges().updated).toEqual([expect.objectContaining({ original: { id: 'a', onHand: 10, reserved: 3, available: 7 }, changed: ['available'] })])
  })

  it('uses a source version delivered while the save was running as the baseline', async () => {
    let finish!: () => void
    const t = createTable<Stock>({ data: start, columns, onSave: () => new Promise<void>(resolve => { finish = resolve }) })
    t.setCell('a', 'reserved', 3)
    const saving = t.save()
    await Promise.resolve()
    t.syncData([{ id: 'a', onHand: 10, reserved: 3, available: 7 }])
    expect(t.getStatus().conflictCells).toBe(0)
    finish()
    await saving
    expect(t.getRow('a')).toEqual({ id: 'a', onHand: 10, reserved: 3, available: 7 })
    expect(t.getStatus().changedRows).toBe(0)
  })

  it('still marks a later concurrent change as a conflict', async () => {
    const t = createTable<Stock>({ data: start, columns, onSave: () => {} })
    t.setCell('a', 'reserved', 3)
    await t.save()
    t.syncData([{ id: 'a', onHand: 10, reserved: 3, available: 7 }])
    t.setCell('a', 'available', 20)
    t.syncData([{ id: 'a', onHand: 11, reserved: 3, available: 8 }])
    expect(t.getCell('a', 'available').conflict).toEqual({ theirs: 8 })
  })
})

describe('a new row delivered by the source before its save finishes', () => {
  it('appears once, with the source version', async () => {
    type Item = { id: string; name: string }
    let finish!: (value: { created: Item[] }) => void
    const t = createTable<Item>({
      data: [{ id: 'a', name: 'A' }],
      columns: [{ field: 'name', type: 'text' }],
      onSave: () => new Promise(resolve => { finish = resolve }),
    })
    const key = t.insertRow({ values: { name: 'New' } })!
    const saving = t.save()
    await Promise.resolve()
    // A local database commits and publishes before the save call returns.
    t.syncData([{ id: 'a', name: 'A' }, { id: 'srv-1', name: 'New' }])
    finish({ created: [{ id: 'srv-1', name: 'New' }] })
    await saving
    expect(t.getRows()).toEqual([{ id: 'a', name: 'A' }, { id: 'srv-1', name: 'New' }])
    expect(t.getRowById('srv-1')).toBe(t.getRow(key))
    expect(t.getStatus().changedRows).toBe(0)
  })
})
