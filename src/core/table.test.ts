import { describe, expect, it, vi } from 'vitest'
import { defineColumns } from './columns.js'
import { defineFieldType } from './field-type.js'
import { createTable, type TableOptions } from './table.js'

type Product = { id: number; name: string; price: number | null; status: string; tags: string[]; active: boolean; locked?: boolean }

const columns = defineColumns<Product>([
  { field: 'name', type: 'text', required: true },
  { field: 'price', type: 'number', min: 0 },
  { field: 'status', type: 'select', options: ['Draft', 'Live'] },
  { field: 'tags', type: 'multiSelect', options: ['a', 'b', 'c'] },
  { field: 'active', type: 'checkbox', readOnly: row => row.locked === true },
])

const data: Product[] = [
  { id: 1, name: 'Apple', price: 3, status: 'Live', tags: ['a'], active: true },
  { id: 2, name: 'Banana', price: 1, status: 'Draft', tags: [], active: false },
  { id: 3, name: 'Cherry', price: null, status: 'Live', tags: ['b', 'c'], active: true, locked: true },
]

function table(options: Partial<TableOptions<Product>> = {}) {
  return createTable<Product>({ data, columns, ...options })
}

const all = (t: ReturnType<typeof table>) => ({ rowStart: 0, rowEnd: t.getRowCount() - 1, colStart: 0, colEnd: t.getColumns().length - 1 })

describe('editing', () => {
  it('edits a cell, tracks the change and leaves the input rows untouched', () => {
    const t = table()
    expect(t.setCellText(1, 'price', '4.5')).toEqual({ applied: 1, errors: [] })
    expect(t.getRow(1)?.price).toBe(4.5)
    expect(data[0]!.price).toBe(3)
    expect(t.getCell(1, 'price')).toMatchObject({ changed: true, error: undefined })
    expect(t.getStatus().changedRows).toBe(1)
  })

  it('editing back to the original value clears the change', () => {
    const t = table()
    t.setCell(1, 'name', 'Apricot')
    t.setCell(1, 'name', 'Apple')
    expect(t.getCell(1, 'name').changed).toBe(false)
    expect(t.getStatus().changedRows).toBe(0)
  })

  it('rejects unparseable text and read-only cells', () => {
    const t = table()
    expect(t.setCellText(1, 'price', 'abc').errors[0]?.message).toBe('Not a number')
    expect(t.setCellText(1, 'status', 'Gone').errors[0]?.message).toMatch(/not an option/)
    expect(t.setCell(3, 'active', false).errors[0]?.message).toBe('Read-only')
    expect(t.getStatus().changedRows).toBe(0)
  })

  it('marks invalid values without rejecting them', () => {
    const t = table()
    t.setCell(1, 'price', -1)
    t.setCell(2, 'name', '')
    expect(t.getCell(1, 'price').error).toBe('Must be at least 0')
    expect(t.getCell(2, 'name').error).toBe('Required')
    expect(t.getStatus().invalidCells).toBe(2)
  })

  it('treats unchecked and empty checkboxes, and empty text and null, as equal', () => {
    const t = table()
    t.setCell(2, 'active', null)
    t.setCell(2, 'tags', null)
    expect(t.getStatus().changedRows).toBe(0)
  })

  it('notifies subscribers once per action', () => {
    const t = table()
    const listener = vi.fn()
    t.subscribe(listener)
    t.paste({ rowStart: 0, rowEnd: 0, colStart: 0, colEnd: 0 }, 'x\ny\nz')
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('clipboard and fill', () => {
  it('copies display text as TSV', () => {
    const t = table()
    expect(t.copy({ rowStart: 0, rowEnd: 2, colStart: 0, colEnd: 3 })).toBe('Apple\t3\tLive\ta\nBanana\t1\tDraft\t\nCherry\t\tLive\tb, c')
  })

  it('round-trips a copied range through paste', () => {
    const t = table()
    const text = t.copy(all(t))
    t.clear({ rowStart: 0, rowEnd: 2, colStart: 1, colEnd: 3 })
    expect(t.getRow(1)?.price).toBeNull()
    t.paste(all(t), text)
    expect(t.getStatus().changedRows).toBe(0)
  })

  it('pastes a block, reports bad cells, and adds rows past the end', () => {
    const t = table({ createRow: () => ({ status: 'Draft', tags: [], active: false }) })
    const result = t.paste({ rowStart: 2, rowEnd: 2, colStart: 0, colEnd: 0 }, 'Cherry 2\t9\nDate\tbad\nElder\t5')
    expect(result.applied).toBe(4)
    expect(result.errors).toEqual([expect.objectContaining({ field: 'price', message: 'Not a number' })])
    expect(t.getRowCount()).toBe(5)
    const added = t.getRow(t.getRowKey(4)!)
    expect(added).toMatchObject({ name: 'Elder', price: 5, status: 'Draft' })
    expect(t.getChanges().created).toHaveLength(2)
  })

  it('repeats a single value over the selected range', () => {
    const t = table()
    t.paste({ rowStart: 0, rowEnd: 1, colStart: 1, colEnd: 1 }, '7')
    expect([t.getRow(1)?.price, t.getRow(2)?.price]).toEqual([7, 7])
  })

  it('fills down by repeating the source block, as one undo step', () => {
    const t = table()
    t.fill({ rowStart: 0, rowEnd: 0, colStart: 2, colEnd: 2 }, { rowStart: 0, rowEnd: 2, colStart: 2, colEnd: 2 })
    expect(t.getRows().map(row => row.status)).toEqual(['Live', 'Live', 'Live'])
    t.undo()
    expect(t.getRows().map(row => row.status)).toEqual(['Live', 'Draft', 'Live'])
  })
})

describe('rows', () => {
  it('inserts, duplicates and deletes rows with undo and redo', () => {
    const t = table()
    const key = t.insertRow({ after: 1, values: { name: 'New' } })!
    expect(t.getRows().map(row => row.name)).toEqual(['Apple', 'New', 'Banana', 'Cherry'])
    expect(t.isNewRow(key)).toBe(true)
    const copies = t.duplicateRows([1, 3])
    expect(t.getRows().map(row => row.name)).toEqual(['Apple', 'Apple', 'New', 'Banana', 'Cherry', 'Cherry'])
    expect(t.getRow(copies[0]!)?.id).toBeUndefined()
    t.deleteRows([2, key])
    expect(t.getRows().map(row => row.name)).toEqual(['Apple', 'Apple', 'Cherry', 'Cherry'])
    expect(t.getChanges().deleted).toEqual([2])
    t.undo()
    expect(t.getRows().map(row => row.name)).toEqual(['Apple', 'Apple', 'New', 'Banana', 'Cherry', 'Cherry'])
    expect(t.getChanges().deleted).toEqual([])
    t.undo(); t.undo()
    expect(t.getRows().map(row => row.name)).toEqual(['Apple', 'Banana', 'Cherry'])
    expect(t.getStatus().changedRows).toBe(0)
    t.redo(); t.redo(); t.redo()
    expect(t.getRows().map(row => row.name)).toEqual(['Apple', 'Apple', 'Cherry', 'Cherry'])
  })

  it('inserts before a row', () => {
    const t = table()
    t.insertRow({ before: 1, values: { name: 'First' } })
    expect(t.getRows().map(row => row.name)).toEqual(['First', 'Apple', 'Banana', 'Cherry'])
    expect(t.getRow(t.getRowKey(0)!)?.name).toBe('First')
  })

  it('a new edit clears redo', () => {
    const t = table()
    t.setCell(1, 'name', 'A')
    t.undo()
    t.setCell(1, 'name', 'B')
    expect(t.redo()).toBe(false)
    expect(t.getRow(1)?.name).toBe('B')
  })
})

describe('view', () => {
  it('filters, sorts with empty values last, and searches display text', () => {
    const t = table()
    t.setSort([{ field: 'price', direction: 'desc' }])
    expect(t.getRowKey(0)).toBe(1)
    expect(t.getRowKey(2)).toBe(3)
    t.setSort([{ field: 'price', direction: 'asc' }])
    expect([t.getRowKey(0), t.getRowKey(2)]).toEqual([2, 3])
    t.setFilters([{ field: 'status', operator: 'is', value: 'Live' }])
    expect(t.getRowCount()).toBe(2)
    t.setFilters([])
    t.setSearch('b, c')
    expect(t.getRowCount()).toBe(1)
  })

  it('keeps an edited row in place until the view is refreshed', () => {
    const t = table()
    t.setFilters([{ field: 'status', operator: 'is', value: 'Live' }])
    t.setCell(1, 'status', 'Draft')
    expect(t.getRowCount()).toBe(2)
    t.refreshView()
    expect(t.getRowCount()).toBe(1)
  })

  it('undoing a delete keeps a filtered-out row hidden', () => {
    const t = table()
    t.setFilters([{ field: 'status', operator: 'is', value: 'Live' }])
    t.deleteRows([2])
    t.undo()
    expect(t.getRowCount()).toBe(2)
    expect(t.getRows()).toHaveLength(3)
  })
})

describe('saving', () => {
  it('sends created, updated and deleted rows, then clears the changes', async () => {
    const onSave = vi.fn()
    const t = table({ onSave })
    t.setCell(1, 'price', 4)
    t.deleteRows([2])
    t.insertRow({ values: { name: 'New', status: 'Draft', tags: [], active: false } })
    expect(await t.save()).toEqual({ status: 'saved', errors: 0 })
    expect(onSave).toHaveBeenCalledWith({
      created: [expect.objectContaining({ name: 'New' })],
      updated: [{ id: 1, row: expect.objectContaining({ price: 4 }), changed: ['price'] }],
      deleted: [2],
    })
    expect(t.getStatus().changedRows).toBe(0)
    expect(await t.save()).toEqual({ status: 'nothing-to-save' })
  })

  it('takes server ids for created rows and finds them by id', async () => {
    const t = table({ onSave: changes => ({ created: changes.created.map(row => ({ ...row, id: 99 })) }) })
    const key = t.insertRow({ values: { name: 'New' } })!
    await t.save()
    expect(t.getRowById(99)).toBe(t.getRow(key))
    t.setCell(key, 'name', 'Renamed')
    expect(t.getChanges().updated[0]).toMatchObject({ id: 99, changed: ['name'] })
  })

  it('keeps edits made during a save', async () => {
    let finish!: () => void
    const t = table({ onSave: () => new Promise<void>(resolve => { finish = resolve }) })
    t.setCell(1, 'name', 'Saved')
    const saving = t.save()
    await Promise.resolve()
    expect(t.getStatus().saving).toBe(true)
    t.setCell(1, 'name', 'Later')
    t.setCell(2, 'name', 'Other')
    finish()
    await saving
    expect(t.getChanges().updated.map(entry => entry.id).sort()).toEqual([1, 2])
    t.setCell(1, 'name', 'Saved')
    expect(t.getCell(1, 'name').changed).toBe(false)
  })

  it('merges server values into fields not edited during the save', async () => {
    let finish!: (value: { updated: Product[] }) => void
    const t = table({ onSave: () => new Promise(resolve => { finish = resolve }) })
    t.setCell(1, 'name', 'apple')
    const saving = t.save()
    await Promise.resolve()
    t.setCell(1, 'price', 10)
    finish({ updated: [{ ...data[0]!, name: 'Apple (normalized)' }] })
    await saving
    expect(t.getRow(1)).toMatchObject({ name: 'Apple (normalized)', price: 10 })
    expect(t.getChanges().updated).toEqual([expect.objectContaining({ changed: ['price'] })])
  })

  it('keeps rejected rows changed with their message', async () => {
    const t = table({ onSave: () => ({ errors: [{ id: 2, message: 'Locked on server' }] }) })
    t.setCell(1, 'name', 'A')
    t.setCell(2, 'name', 'B')
    expect(await t.save()).toEqual({ status: 'saved', errors: 1 })
    expect(t.getRowSaveError(2)).toBe('Locked on server')
    expect(t.getChanges().updated.map(entry => entry.id)).toEqual([2])
  })

  it('keeps all changes when the save throws', async () => {
    const t = table({ onSave: () => { throw new Error('offline') } })
    t.setCell(1, 'name', 'A')
    expect(await t.save()).toEqual({ status: 'failed', error: 'offline' })
    expect(t.getStatus()).toMatchObject({ changedRows: 1, saveError: 'offline' })
  })

  it('does not save invalid cells', async () => {
    const onSave = vi.fn()
    const t = table({ onSave })
    t.setCell(1, 'price', -5)
    expect(await t.save()).toEqual({ status: 'invalid', cells: 1 })
    expect(onSave).not.toHaveBeenCalled()
  })

  it('undo after a save makes the row changed again', async () => {
    const t = table({ onSave: () => {} })
    t.setCell(1, 'name', 'A')
    await t.save()
    t.undo()
    expect(t.getChanges().updated).toEqual([expect.objectContaining({ id: 1, changed: ['name'] })])
  })

  it('undoing a saved insert deletes the row on the next save', async () => {
    const onSave = vi.fn((changes: { created: Product[] }) => ({ created: changes.created.map(row => ({ ...row, id: 50 })) }))
    const t = table({ onSave })
    t.insertRow({ values: { name: 'New' } })
    await t.save()
    t.undo()
    await t.save()
    expect(onSave).toHaveBeenLastCalledWith({ created: [], updated: [], deleted: [50] })
  })

  it('auto-saves after the debounce', async () => {
    vi.useFakeTimers()
    try {
      const onSave = vi.fn()
      const t = table({ onSave, autoSave: 300 })
      t.setCell(1, 'name', 'A')
      t.setCell(1, 'name', 'B')
      await vi.advanceTimersByTimeAsync(299)
      expect(onSave).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(onSave).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('multi-cell editing', () => {
  const col = (field: string, t: ReturnType<typeof table>) => t.getColumns().findIndex(column => column.field === field)

  it('writes one value to every cell of several ranges as one undo step', () => {
    const t = table()
    const name = col('name', t)
    const ranges = [{ rowStart: 0, rowEnd: 0, colStart: name, colEnd: name }, { rowStart: 2, rowEnd: 2, colStart: name, colEnd: name }]
    expect(t.setValue(ranges, 'Same', 'name')).toEqual({ applied: 2, errors: [] })
    expect(t.getRows().map(row => row.name)).toEqual(['Same', 'Banana', 'Same'])
    t.undo()
    expect(t.getRows().map(row => row.name)).toEqual(['Apple', 'Banana', 'Cherry'])
  })

  it('converts the value for other columns and reports cells that cannot take it', () => {
    const t = table()
    const result = t.setValue({ rowStart: 0, rowEnd: 0, colStart: 0, colEnd: 2 }, '5', 'name')
    expect(t.getRow(1)).toMatchObject({ name: '5', price: 5, status: 'Live' })
    expect(result.errors).toEqual([expect.objectContaining({ field: 'status', message: '"5" is not an option' })])
  })

  it('skips read-only cells', () => {
    const t = table()
    const active = col('active', t)
    const result = t.setValue({ rowStart: 0, rowEnd: 2, colStart: active, colEnd: active }, false, 'active')
    expect(result.applied).toBe(1)
    expect(result.errors).toEqual([expect.objectContaining({ row: 3, message: 'Read-only' })])
  })

  it('visits overlapping ranges once', () => {
    const t = table()
    const price = col('price', t)
    const result = t.bulkEdit([{ rowStart: 0, rowEnd: 1, colStart: price, colEnd: price }, { rowStart: 1, rowEnd: 1, colStart: price, colEnd: price }],
      [{ field: 'price', operation: 'add', args: { amount: 10 } }])
    expect(result.applied).toBe(2)
    expect([t.getRow(1)?.price, t.getRow(2)?.price]).toEqual([13, 11])
  })

  it('previews and applies per-column operations', () => {
    const t = table()
    const all = { rowStart: 0, rowEnd: 2, colStart: 0, colEnd: 4 }
    const edits = [
      { field: 'name', operation: 'affix', args: { prefix: 'Fresh ' } },
      { field: 'price', operation: 'multiply', args: { factor: 1.1 } },
      { field: 'tags', operation: 'add', args: { values: ['c'] } },
      { field: 'active', operation: 'set', args: { value: true } },
    ]
    expect(t.previewBulkEdit(all, edits)).toEqual({
      // 3 names + 2 prices (one empty) + 2 tag lists (one already has c) + 1 checkbox (one already set, one read-only)
      changes: 8, unchanged: 3, errors: [expect.objectContaining({ row: 3, field: 'active', message: 'Read-only' })],
    })
    expect(t.getStatus().changedRows).toBe(0)
    t.bulkEdit(all, edits)
    expect(t.getRows().map(row => [row.name, row.price, row.tags, row.active])).toEqual([
      ['Fresh Apple', 3.3, ['a', 'c'], true],
      ['Fresh Banana', 1.1, ['c'], true],
      ['Fresh Cherry', null, ['b', 'c'], true],
    ])
    expect(t.undo()).toBe(true)
    expect(t.getStatus().changedRows).toBe(0)
  })

  it('finds and replaces text, literally or by regex', () => {
    const t = table()
    const name = { rowStart: 0, rowEnd: 2, colStart: 0, colEnd: 0 }
    t.bulkEdit(name, [{ field: 'name', operation: 'replace', args: { find: 'an', replacement: '$1-' } }])
    expect(t.getRow(2)?.name).toBe('B$1-$1-a')
    t.bulkEdit(name, [{ field: 'name', operation: 'replace', args: { find: '^(\\w)', replacement: '[$1]', regex: true } }])
    expect(t.getRow(1)?.name).toBe('[A]pple')
    expect(t.previewBulkEdit(name, [{ field: 'name', operation: 'replace', args: { find: '(', regex: true } }]).errors[0]?.message).toBe('Invalid regular expression')
  })

  it('removes tags and shifts dates', () => {
    type Task = { id: number; due: string | null; labels: string[] }
    const t = createTable<Task>({
      data: [{ id: 1, due: '2026-01-30', labels: ['x', 'y'] }, { id: 2, due: null, labels: ['y'] }],
      columns: [{ field: 'due', type: 'date' }, { field: 'labels', type: 'multiSelect', options: ['x', 'y'] }],
    })
    t.bulkEdit({ rowStart: 0, rowEnd: 1, colStart: 0, colEnd: 1 }, [
      { field: 'due', operation: 'shift', args: { days: 3 } },
      { field: 'labels', operation: 'remove', args: { values: ['y'] } },
    ])
    expect(t.getRows()).toEqual([{ id: 1, due: '2026-02-02', labels: ['x'] }, { id: 2, due: null, labels: null }])
  })

  it('clears and pastes into several ranges', () => {
    const t = table()
    const ranges = [{ rowStart: 0, rowEnd: 0, colStart: 1, colEnd: 1 }, { rowStart: 2, rowEnd: 2, colStart: 1, colEnd: 1 }]
    t.paste(ranges, '9')
    expect(t.getRows().map(row => row.price)).toEqual([9, 1, 9])
    t.clear(ranges)
    expect(t.getRows().map(row => row.price)).toEqual([null, 1, null])
    t.undo(); t.undo()
    expect(t.getRows().map(row => row.price)).toEqual([3, 1, null])
  })

  it('copies ranges on the same rows side by side, and on the same columns stacked', () => {
    const t = table()
    expect(t.copy([{ rowStart: 0, rowEnd: 1, colStart: 2, colEnd: 2 }, { rowStart: 0, rowEnd: 1, colStart: 0, colEnd: 0 }])).toBe('Apple\tLive\nBanana\tDraft')
    expect(t.copy([{ rowStart: 2, rowEnd: 2, colStart: 0, colEnd: 0 }, { rowStart: 0, rowEnd: 0, colStart: 0, colEnd: 0 }])).toBe('Apple\nCherry')
    expect(t.canCopyAll([{ rowStart: 0, rowEnd: 0, colStart: 0, colEnd: 0 }, { rowStart: 1, rowEnd: 1, colStart: 1, colEnd: 1 }])).toBe(false)
  })

  it('applies a custom type\'s bulk operation', () => {
    const counter = defineFieldType<number>({
      name: 'counter',
      parse: text => Number(text),
      bulk: { reset: { label: 'Reset', apply: () => 0 } },
    })
    const t = createTable<{ id: number; n: number }>({ data: [{ id: 1, n: 4 }], columns: [{ field: 'n', type: counter }] })
    expect(Object.keys(counter.bulk)).toEqual(['set', 'reset', 'clear'])
    t.bulkEdit({ rowStart: 0, rowEnd: 0, colStart: 0, colEnd: 0 }, [{ field: 'n', operation: 'reset' }])
    expect(t.getRow(1)?.n).toBe(0)
  })
})

describe('quick actions', () => {
  const actions = (t: ReturnType<typeof table>, field: string) => {
    const column = t.getColumn(field)!
    return { column, list: column.type.quickActions(column.options) }
  }
  const run = (t: ReturnType<typeof table>, field: string, path: string[], range = { rowStart: 0, rowEnd: 2, colStart: 0, colEnd: 4 }) => {
    const { column, list } = actions(t, field)
    let action = list.find(entry => entry.label === path[0])
    for (const label of path.slice(1)) action = action?.items?.find(entry => entry.label === label)
    return t.updateCells(range, field, value => action!.apply!(value, column.options))
  }

  it('sets a select option on every selected cell', () => {
    const t = table()
    const { list } = actions(t, 'status')
    expect(list[0]!.items!.map(item => [item.label, item.preview])).toEqual([['Draft', 'Draft'], ['Live', 'Live']])
    run(t, 'status', ['Set to', 'Draft'])
    expect(t.getRows().map(row => row.status)).toEqual(['Draft', 'Draft', 'Draft'])
  })

  it('checks, unchecks and toggles checkboxes, skipping read-only cells', () => {
    const t = table()
    expect(run(t, 'active', ['Toggle each'])).toMatchObject({ applied: 2, errors: [expect.objectContaining({ message: 'Read-only' })] })
    expect(t.getRows().map(row => row.active)).toEqual([false, true, true])
    run(t, 'active', ['Uncheck all'])
    expect(t.getRows().map(row => row.active)).toEqual([false, false, true])
  })

  it('adds and removes tags in option order', () => {
    const t = table()
    run(t, 'tags', ['Add', 'a'])
    expect(t.getRows().map(row => row.tags)).toEqual([['a'], ['a'], ['a', 'b', 'c']])
    run(t, 'tags', ['Remove', 'a'])
    expect(t.getRows().map(row => row.tags)).toEqual([null, null, ['b', 'c']])
  })

  it('adjusts numbers and dates', () => {
    const t = table()
    run(t, 'price', ['+1'])
    expect(t.getRows().map(row => row.price)).toEqual([4, 2, null])
    const dates = createTable<{ id: number; due: string }>({ data: [{ id: 1, due: '2026-01-31' }], columns: [{ field: 'due', type: 'date' }] })
    const column = dates.getColumn('due')!
    const shift = column.type.quickActions(column.options).find(entry => entry.label === 'Shift')!.items!
    dates.updateCells({ rowStart: 0, rowEnd: 0, colStart: 0, colEnd: 0 }, 'due', value => shift.find(entry => entry.label === '+1 month')!.apply!(value, {}))
    expect(dates.getRow(1)?.due).toBe('2026-02-28')
  })

  it('cleans up text', () => {
    const t = table()
    t.setCell(1, 'name', '  big   apple ')
    run(t, 'name', ['Trim spaces'])
    run(t, 'name', ['Change case', 'Title Case'])
    expect(t.getRows().map(row => row.name)).toEqual(['Big Apple', 'Banana', 'Cherry'])
  })
})

describe('custom field types', () => {
  it('uses a custom type for parsing, display and sorting', () => {
    const rating = defineFieldType<number, { max: number }>({
      name: 'rating',
      parse: (text, { max }) => {
        const stars = text.includes('★') ? text.length : Number(text)
        return Number.isInteger(stars) && stars >= 0 && stars <= max ? stars : { error: `0–${max} stars` }
      },
      format: value => '★'.repeat(value),
      compare: (a, b) => a - b,
    })
    type Review = { id: string; score: number }
    const t = createTable<Review>({
      data: [{ id: 'a', score: 2 }, { id: 'b', score: 4 }],
      columns: [{ field: 'score', type: rating.with({ max: 5 }) }],
    })
    expect(t.setCellText('a', 'score', '9').errors[0]?.message).toBe('0–5 stars')
    t.setCellText('a', 'score', '★★★★★')
    expect(t.copy({ rowStart: 0, rowEnd: 1, colStart: 0, colEnd: 0 })).toBe('★★★★★\n★★★★')
    t.setFilters([{ field: 'score', operator: 'isNotEmpty' }])
    t.setSort([{ field: 'score', direction: 'asc' }])
    expect(t.getRowKey(0)).toBe('b')
  })
})

describe('setup errors', () => {
  it('explains missing and duplicate ids', () => {
    expect(() => createTable({ data: [{ sku: 'x' }], columns: [{ field: 'sku', type: 'text' }] })).toThrow(/rowId/)
    expect(() => createTable({ data: [{ id: 1 }, { id: 1 }], columns: [] })).toThrow(/Duplicate row id "1"/)
  })
})
