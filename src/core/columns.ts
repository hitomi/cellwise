import type { ReactNode } from 'react'
import { builtinTypesFor, type NumberOptions, type SelectOptions } from './builtin-types.js'
import type { ConfiguredFieldType, FieldType } from './field-type.js'
import { en, type Messages } from './messages.js'

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

interface ColumnDisplay<Row, Value> {
  /** Header text. Default: the field name or key. */
  title?: string
  /** Width in px. Default 160. */
  width?: number
  minWidth?: number
  /** Keep the column visible while scrolling horizontally. */
  pinned?: boolean
  sortable?: boolean
  filterable?: boolean
  /** Custom cell content for this column, instead of the field type's. */
  render?: (value: Value | null, row: Row) => ReactNode
  /** Extra control in the column header, e.g. a filter button. */
  headerAction?: ReactNode
}

export interface ColumnBase<Row, K extends FieldKey<Row>> extends ColumnDisplay<Row, NonNullable<Row[K]>> {
  field: K
  readOnly?: boolean | ((row: Row) => boolean)
  required?: boolean
  /** Return a message to mark the value invalid. Called for non-empty values. */
  validate?: (value: NonNullable<Row[K]>, row: Row) => string | undefined
  /** Open the editor on the first click instead of selecting first. */
  clickToEdit?: boolean
  /**
   * Other fields this value depends on. When one of them changes in the source
   * while this cell has an unsaved edit, the cell is marked as a conflict
   * instead of silently saving over the newer data.
   */
  dependsOn?: readonly FieldKey<Row>[]
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

/** A read-only column computed from the row, e.g. a total or a status label. */
export type ComputedColumn<Row> = ColumnDisplay<Row, any> & {
  /** Unique key used for sorting, filtering and selection. */
  key: string
  value: (row: Row) => unknown
  field?: never
} & (
  | { [T in keyof BuiltinValue]: { type: T } & BuiltinOptions[T] }[keyof BuiltinValue]
  | { type: FieldType<any, any> | ConfiguredFieldType<any, any> }
)

/** A column definition, checked against the row type. */
export type Column<Row> =
  | { [K in FieldKey<Row>]: BuiltinColumn<Row, K> | CustomColumn<Row, K> }[FieldKey<Row>]
  | ComputedColumn<Row>

/** Identity helper that types an array of columns outside JSX: `defineColumns<Product>([...])`. */
export function defineColumns<Row>(columns: readonly Column<Row>[]): readonly Column<Row>[] {
  return columns
}

export interface ResolvedColumn<Row = any> {
  /** The row field, or the key of a computed column. */
  readonly field: string
  readonly computed: boolean
  /** Read-only for every row: computed, or `readOnly: true`. */
  readonly alwaysReadOnly: boolean
  readonly title: string
  readonly width: number
  readonly minWidth: number
  readonly pinned: boolean
  readonly type: FieldType
  readonly options: unknown
  readonly required: boolean
  readonly sortable: boolean
  readonly filterable: boolean
  readonly clickToEdit: boolean
  readonly dependsOn: readonly string[]
  readonly render: ((value: any, row: Row) => ReactNode) | undefined
  readonly headerAction: ReactNode
  readonly definition: Column<Row>
  /** The cell value of a row. */
  get(row: Row): unknown
  isReadOnly(row: Row): boolean
  validate(value: unknown, row: Row): string | undefined
}

const baseKeys = new Set([
  'field', 'key', 'value', 'title', 'width', 'minWidth', 'pinned', 'readOnly', 'required', 'validate', 'sortable',
  'filterable', 'type', 'render', 'clickToEdit', 'dependsOn', 'headerAction',
])

export function resolveColumn<Row>(definition: Column<Row>, messages: Messages = en): ResolvedColumn<Row> {
  const column = definition as Partial<ColumnBase<Row, FieldKey<Row>>> & {
    key?: string; value?: (row: Row) => unknown; type: string | FieldType | ConfiguredFieldType; render?: ResolvedColumn<Row>['render']
    headerAction?: ReactNode
  }
  const computed = typeof column.value === 'function'
  const field = computed ? column.key : column.field
  if (!field) throw new Error('A column needs a `field`, or a `key` and `value` for a computed column.')
  let type: FieldType
  let options: unknown
  if (typeof column.type === 'string') {
    const builtin = builtinTypesFor(messages)[column.type as keyof ReturnType<typeof builtinTypesFor>] as FieldType | undefined
    if (!builtin) throw new Error(`Column "${field}": unknown field type "${column.type}". Pass a custom type object instead of a string.`)
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
  const readOnly = computed ? true : column.readOnly
  const validate = column.validate as ((value: unknown, row: Row) => string | undefined) | undefined
  const required = column.required ?? false
  const read = computed ? column.value! : (row: Row) => (row as Record<string, unknown>)[field]
  return {
    field,
    computed,
    alwaysReadOnly: readOnly === true,
    title: column.title ?? field,
    width: column.width ?? 160,
    minWidth: column.minWidth ?? 60,
    pinned: column.pinned ?? false,
    type,
    options,
    required,
    sortable: column.sortable ?? true,
    filterable: column.filterable ?? true,
    clickToEdit: column.clickToEdit ?? false,
    dependsOn: column.dependsOn ?? [],
    render: column.render,
    headerAction: column.headerAction,
    definition,
    get: read,
    isReadOnly: typeof readOnly === 'function' ? readOnly : () => readOnly ?? false,
    validate(value, row) {
      if (computed) return undefined
      if (type.isEmpty(value)) return required ? messages.errors.required : undefined
      return type.validate(value, options) ?? validate?.(value, row)
    },
  }
}
