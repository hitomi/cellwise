import { describe, expect, it } from 'vitest'
import { defineColumns } from './columns.js'
import { createTable } from './table.js'

// Performance budget from SPEC.md. Budgets carry headroom for slow CI machines.

type Row = { id: number; name: string; amount: number; status: string; day: string } & Record<`f${number}`, string>
const extra = Array.from({ length: 25 }, (_, index) => `f${index}` as const)
const columns = defineColumns<Row>([
  { field: 'name', type: 'text' },
  { field: 'amount', type: 'number' },
  { field: 'status', type: 'select', options: ['Open', 'Closed', 'Pending'] },
  { field: 'day', type: 'date' },
  ...extra.map(field => ({ field, type: 'text' as const })),
])

function rows(count: number): Row[] {
  return Array.from({ length: count }, (_, id) => {
    const row = { id, name: `Name ${id % 997}`, amount: (id * 7919) % 10007, status: ['Open', 'Closed', 'Pending'][id % 3]!, day: `2026-0${1 + (id % 9)}-1${id % 10}` } as Row
    for (const field of extra) row[field] = `${field}-${id % 101}`
    return row
  })
}

function time(fn: () => void) {
  const start = performance.now()
  fn()
  return performance.now() - start
}

describe('performance budget, 100k rows × 30 columns', () => {
  const data = rows(100_000)

  it('single cell edit stays under 1 ms regardless of history length', () => {
    const table = createTable({ data, columns })
    const samples: number[] = []
    for (let i = 0; i < 2000; i++) samples.push(time(() => table.setCellText(i * 37 % 100_000, 'name', `edit ${i}`)))
    const average = (list: number[]) => list.reduce((sum, value) => sum + value, 0) / list.length
    const early = average(samples.slice(10, 110)), late = average(samples.slice(-100))
    console.info(`edit: first 100 ${early.toFixed(3)} ms, last 100 ${late.toFixed(3)} ms`)
    expect(late).toBeLessThan(1)
    expect(late).toBeLessThan(early * 3 + 0.05)
  })

  it('pastes 10k cells under 100 ms', () => {
    const table = createTable({ data, columns })
    const text = Array.from({ length: 1000 }, (_, r) => Array.from({ length: 10 }, (_, c) => `p${r}-${c}`).join('\t')).join('\n')
    const elapsed = time(() => table.paste({ rowStart: 500, rowEnd: 500, colStart: 4, colEnd: 4 }, text))
    console.info(`paste 10k cells: ${elapsed.toFixed(1)} ms`)
    expect(elapsed).toBeLessThan(100)
    expect(time(() => table.undo())).toBeLessThan(100)
  })

  it('sorts and filters under 150 ms', () => {
    const table = createTable({ data, columns })
    const sortTime = time(() => table.setSort([{ field: 'amount', direction: 'desc' }]))
    const filterTime = time(() => table.setFilters([{ field: 'status', operator: 'is', value: 'Open' }]))
    const searchTime = time(() => table.setSearch('name 42'))
    console.info(`sort ${sortTime.toFixed(1)} ms, filter ${filterTime.toFixed(1)} ms, search ${searchTime.toFixed(1)} ms`)
    expect(sortTime).toBeLessThan(150)
    expect(filterTime).toBeLessThan(150)
    // Search formats every cell; budgeted separately.
    expect(searchTime).toBeLessThan(400)
  })

  it('deletes and restores 10k rows under 100 ms each', () => {
    const table = createTable({ data, columns })
    const keys = Array.from({ length: 10_000 }, (_, index) => index * 10)
    expect(time(() => table.deleteRows(keys))).toBeLessThan(100)
    expect(time(() => table.undo())).toBeLessThan(100)
    expect(table.getRowCount()).toBe(100_000)
  })
})
