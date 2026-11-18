import { builtinTypes, type NumberOptions, type SelectOptions } from './builtin-types.js'
import type { ConfiguredFieldType, FieldType } from './field-type.js'

export type RowId = string | number
export type FieldKey<Row> = Extract<keyof Row, string>

interface BuiltinValue {
  text: string
  number: number
  checkbox: boolean
  date: string
  select: string
  multiSelect: readonly string[]
}
interface BuiltinOptions {
  text: {}
  number: NumberOptions
  checkbox: {}
  date: {}
  select: SelectOptions
  multiSelect: SelectOptions
}

export interface ColumnBase<Row, K extends FieldKey<Row>> {
  field: K
  /** Header text. Default: the field name. */
  title?: string
  /** Width in px. Default 160. */
  width?: number
  minWidth?: number
  /** Keep the column visible while scrolling horizontally. */
  pinned?: boolean
  readOnly?: boolean | ((row: Row) => boolean)
  required?: boolean
  /** Return a message to mark the value invalid. Called for non-empty values. */
  validate?: (value: NonNullable<Row[K]>, row: Row) => string | undefined
  sortable?: boolean
  filterable?: boolean
}

type Value<Row, K extends keyof Row> = NonNullable<Row[K]>

type BuiltinColumn<Row, K extends FieldKey<Row>> = {
  [T in keyof BuiltinValue]: [Value<Row, K>] extends [BuiltinValue[T]]
    ? ColumnBase<Row, K> & { type: T } & BuiltinOptions[T]
    : never
}[keyof BuiltinValue]

type CustomColumn<Row, K extends FieldKey<Row>> = ColumnBase<Row, K> & {
  type: FieldType<Value<Row, K>, any> | ConfiguredFieldType<Value<Row, K>, any>
}

/** A column definition, checked against the row type. */
export type Column<Row> = {
  [K in FieldKey<Row>]: BuiltinColumn<Row, K> | CustomColumn<Row, K>
}[FieldKey<Row>]

/** Identity helper that types an array of columns outside JSX: `defineColumns<Product>([...])`. */
export function defineColumns<Row>(columns: readonly Column<Row>[]): readonly Column<Row>[] {
  return columns
}

export interface ResolvedColumn<Row = any> {
  readonly field: string
  readonly title: string
  readonly width: number
  readonly minWidth: number
  readonly pinned: boolean
  readonly type: FieldType
  readonly options: unknown
  readonly required: boolean
  readonly sortable: boolean
  readonly filterable: boolean
  readonly definition: Column<Row>
  isReadOnly(row: Row): boolean
  validate(value: unknown, row: Row): string | undefined
}

const baseKeys = new Set(['field', 'title', 'width', 'minWidth', 'pinned', 'readOnly', 'required', 'validate', 'sortable', 'filterable', 'type'])

export function resolveColumn<Row>(definition: Column<Row>): ResolvedColumn<Row> {
  const column = definition as ColumnBase<Row, FieldKey<Row>> & { type: string | FieldType | ConfiguredFieldType }
  let type: FieldType
  let options: unknown
  if (typeof column.type === 'string') {
    const builtin = builtinTypes[column.type as keyof typeof builtinTypes] as FieldType | undefined
    if (!builtin) throw new Error(`Column "${column.field}": unknown field type "${column.type}". Pass a custom type object instead of a string.`)
    type = builtin
    // Built-in type options sit directly on the column, e.g. `{ type: 'select', options: [...] }`.
    options = Object.fromEntries(Object.entries(column).filter(([key]) => !baseKeys.has(key)))
  } else if ('with' in column.type) {
    type = column.type
    options = {}
  } else {
    type = column.type.type
    options = column.type.options
  }
  const readOnly = column.readOnly
  const validate = column.validate as ((value: unknown, row: Row) => string | undefined) | undefined
  const required = column.required ?? false
  return {
    field: column.field,
    title: column.title ?? column.field,
    width: column.width ?? 160,
    minWidth: column.minWidth ?? 60,
    pinned: column.pinned ?? false,
    type,
    options,
    required,
    sortable: column.sortable ?? true,
    filterable: column.filterable ?? true,
    definition,
    isReadOnly: typeof readOnly === 'function' ? readOnly : () => readOnly ?? false,
    validate(value, row) {
      if (type.isEmpty(value)) return required ? 'Required' : undefined
      return type.validate(value, options) ?? validate?.(value, row)
    },
  }
}
