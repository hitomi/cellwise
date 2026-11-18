import { describe, expect, it } from 'vitest'
import { defineColumns, type Column } from './columns.js'
import { defineFieldType } from './field-type.js'

type Product = { id: number; name: string; price: number; status: 'Draft' | 'Live'; tags: string[]; active: boolean; launch?: string | null }

const rating = defineFieldType<number, { max: number }>({ name: 'rating', parse: text => Number(text) })

describe('column types', () => {
  it('accepts valid columns', () => {
    const columns = defineColumns<Product>([
      { field: 'name', type: 'text', width: 200 },
      { field: 'price', type: 'number', precision: 2, validate: value => value > 1000 ? 'Too high' : undefined },
      { field: 'status', type: 'select', options: ['Draft', 'Live'] },
      { field: 'tags', type: 'multiSelect', options: [{ value: 'a', label: 'Alpha', color: 'red' }] },
      { field: 'active', type: 'checkbox' },
      { field: 'launch', type: 'date' },
      { field: 'price', type: rating.with({ max: 5 }) },
    ])
    expect(columns).toHaveLength(7)
  })

  it('rejects mistakes at compile time', () => {
    const wrong: Column<Product>[] = [
      // @ts-expect-error unknown field
      { field: 'nope', type: 'text' },
      // @ts-expect-error number column on a string field
      { field: 'name', type: 'number' },
      // @ts-expect-error select without options
      { field: 'status', type: 'select' },
      // @ts-expect-error custom number type on a string field
      { field: 'name', type: rating.with({ max: 5 }) },
      // @ts-expect-error validate receives the field's value type
      { field: 'price', type: 'number', validate: (value: string) => value },
    ]
    expect(wrong).toHaveLength(5)
  })
})
