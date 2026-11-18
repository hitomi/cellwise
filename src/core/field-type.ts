import type { ComponentType } from 'react'

/** `null` is an empty cell. `{ error }` rejects the text with a message. */
export type ParseResult<V> = V | null | { error: string }

export interface FilterOperator<V, O> {
  label: string
  /** `'value'` takes one value of the field's type, `'values'` a list, `'none'` nothing. Default `'value'`. */
  input?: 'value' | 'values' | 'none'
  /** Empty cells are passed as `null`. */
  test(value: V | null, arg: any, options: O): boolean
}

export interface BulkInput {
  name: string
  label?: string
  /**
   * `'value'`: one value of the field's type. `'values'`: several (option pickers).
   * `'text'`, `'number'`, `'boolean'`: plain inputs. `'choice'`: one of `choices`.
   */
  kind: 'value' | 'values' | 'text' | 'number' | 'boolean' | 'choice'
  choices?: readonly { value: string; label: string }[]
}

/** An operation applied to every selected cell of a column, e.g. "add prefix" or "increase by". */
export interface BulkOperation<V, O> {
  label: string
  inputs?: readonly BulkInput[]
  /** New value for one cell, given its current value (`null` when empty) and the inputs. */
  apply(value: V | null, args: Record<string, any>, options: O): ParseResult<V>
}

/** A one-click edit in the context menu, applied to every selected cell of the column. */
export interface QuickAction<V, O> {
  label: string
  /** Shown instead of the label, rendered with the field's cell renderer (e.g. an option's pill). */
  preview?: V
  /** Entries of a sub-menu. An action has either `items` or `apply`. */
  items?: readonly QuickAction<V, O>[]
  /** New value for one cell (`null` when empty). */
  apply?(value: V | null, options: O): ParseResult<V>
  /** Show a check mark when this is true for every selected cell. */
  isActive?(value: V | null, options: O): boolean
}

/** Lets files be dropped onto (or pasted into) a cell, e.g. image uploads. */
export interface FileHandler<V, O> {
  /** Accepted file types, like the `accept` attribute: `'image/*'`, `'.pdf,application/pdf'`. */
  accept: string
  /**
   * Upload or read the files, then return how to apply them to the cell. The returned
   * function receives the cell's value at the time the upload finishes.
   */
  receive(files: File[], options: O): Promise<(value: V | null) => ParseResult<V>>
}

/** Whether a file (or a drag item's MIME type) matches an `accept` list. */
export function acceptsFile(accept: string, type: string, name = '') {
  return accept.split(',').map(entry => entry.trim().toLowerCase()).some(pattern => {
    if (!pattern) return false
    if (pattern.startsWith('.')) return name.toLowerCase().endsWith(pattern)
    if (pattern.endsWith('/*')) return type.toLowerCase().startsWith(pattern.slice(0, -1))
    return type.toLowerCase() === pattern
  })
}

export interface CellProps<V, O> {
  value: V | null
  options: O
}

export interface EditorProps<V, O> {
  value: V | null
  options: O
  /** Text typed to open the editor, if it was opened by typing. */
  initialText?: string
  onChange(value: V | null): void
  /** Commit the current (or given) value and close. */
  onCommit(value?: V | null): void
  onCancel(): void
}

export interface FieldTypeSpec<V, O = {}> {
  name: string
  /** Turns typed or pasted text into a value. */
  parse(text: string, options: O): ParseResult<V>
  /** Display and copy text. Default: `String(value)`. */
  format?(value: V, options: O): string
  /** Default: `Object.is`. */
  equals?(a: V, b: V): boolean
  /** Sort order. Default: compares `format()` output. */
  compare?(a: V, b: V, options: O): number
  /** Extra emptiness rule; `null`, `undefined`, `''` and `[]` are always empty. */
  isEmpty?(value: V): boolean
  validate?(value: V, options: O): string | undefined
  /** Type-specific filters. `isEmpty` / `isNotEmpty` are added to every type. */
  filters?: Record<string, FilterOperator<V, O>>
  /** Type-specific bulk edit operations. `set` and `clear` are added to every type. */
  bulk?: Record<string, BulkOperation<V, O>>
  /** Context-menu shortcuts for the column's selected cells. */
  quickActions?(options: O): readonly QuickAction<V, O>[]
  /** Accept files dropped onto or pasted into the cell. */
  files?: FileHandler<V, O>
  Cell?: ComponentType<CellProps<V, O>>
  Editor?: ComponentType<EditorProps<V, O>>
}

export interface FieldType<V = any, O = any> {
  readonly name: string
  parse(text: string, options: O): ParseResult<V>
  format(value: V, options: O): string
  equals(a: V, b: V): boolean
  compare(a: V, b: V, options: O): number
  isEmpty(value: V | null | undefined): value is null | undefined
  validate(value: V, options: O): string | undefined
  readonly filters: Readonly<Record<string, FilterOperator<V, O>>>
  readonly bulk: Readonly<Record<string, BulkOperation<V, O>>>
  quickActions(options: O): readonly QuickAction<V, O>[]
  readonly files: FileHandler<V, O> | undefined
  readonly Cell: ComponentType<CellProps<V, O>> | undefined
  readonly Editor: ComponentType<EditorProps<V, O>> | undefined
  /** Configure the type for one column: `type: rating.with({ max: 5 })`. */
  with(options: O): ConfiguredFieldType<V, O>
}

export interface ConfiguredFieldType<V = any, O = any> {
  readonly type: FieldType<V, O>
  readonly options: O
}

export function isParseError(result: unknown): result is { error: string } {
  return typeof result === 'object' && result !== null && !Array.isArray(result)
    && typeof (result as { error?: unknown }).error === 'string' && Object.keys(result).length === 1
}

const commonFilters: Record<string, FilterOperator<any, any>> = {
  isEmpty: { label: 'is empty', input: 'none', test: value => value === null },
  isNotEmpty: { label: 'is not empty', input: 'none', test: value => value !== null },
}

const setOperation: BulkOperation<any, any> = {
  label: 'Set to',
  inputs: [{ name: 'value', kind: 'value' }],
  apply: (_value, args) => args.value ?? null,
}
const clearOperation: BulkOperation<any, any> = { label: 'Clear', apply: () => null }

export function defineFieldType<V, O = {}>(spec: FieldTypeSpec<V, O>): FieldType<V, O> {
  const format = spec.format ?? ((value: V) => String(value))
  const extraEmpty = spec.isEmpty
  const type: FieldType<V, O> = {
    name: spec.name,
    parse: spec.parse,
    format,
    equals: spec.equals ?? Object.is,
    compare: spec.compare ?? ((a, b, options) => compareText(format(a, options), format(b, options))),
    isEmpty: (value): value is null | undefined =>
      value === null || value === undefined || (value as unknown) === ''
      || (Array.isArray(value) && value.length === 0) || (extraEmpty ? extraEmpty(value) : false),
    validate: spec.validate ?? (() => undefined),
    filters: { ...spec.filters, ...commonFilters },
    bulk: { set: setOperation, ...spec.bulk, clear: clearOperation },
    quickActions: spec.quickActions ?? (() => []),
    files: spec.files,
    Cell: spec.Cell,
    Editor: spec.Editor,
    with: options => ({ type, options }),
  }
  return type
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
export const compareText = (a: string, b: string) => collator.compare(a, b)
