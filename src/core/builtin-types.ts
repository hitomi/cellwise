import { compareText, defineFieldType, type FieldType, type QuickAction } from './field-type.js'
import { en, type Messages } from './messages.js'

export type SelectOption = string | { value: string; label?: string; color?: string }

export interface NumberOptions {
  /** Fixed number of decimals for display and parsing. */
  precision?: number
  min?: number
  max?: number
}
export interface SelectOptions {
  options: readonly SelectOption[]
  /** Multi-select only: accept values that are not in `options` (free tags, with the options as suggestions). */
  allowCreate?: boolean
}

export const optionValue = (option: SelectOption) => typeof option === 'string' ? option : option.value
export const optionLabel = (option: SelectOption) => typeof option === 'string' ? option : option.label ?? option.value

function matchOption(options: readonly SelectOption[], text: string): string | undefined {
  const wanted = text.trim().toLowerCase()
  for (const option of options) {
    if (optionValue(option).toLowerCase() === wanted || optionLabel(option).toLowerCase() === wanted) return optionValue(option)
  }
  return undefined
}

function labelOf(options: readonly SelectOption[], value: string) {
  const option = options.find(entry => optionValue(entry) === value)
  return option ? optionLabel(option) : value
}

/** Round to the column's precision, and remove floating-point noise such as 0.1 + 0.2. */
function roundTo(value: number, precision: number | undefined) {
  return precision === undefined ? Number(value.toPrecision(12)) : Number(value.toFixed(precision))
}

function parts(value: string) {
  return value.split('-').map(Number) as [number, number, number]
}
function addDays(value: string, days: number) {
  const [year, month, day] = parts(value)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}
/** Same day in another month, clamped to that month's last day (Jan 31 + 1 month = Feb 28). */
function addMonths(value: string, months: number) {
  const [year, month, day] = parts(value)
  const last = new Date(Date.UTC(year, month - 1 + months + 1, 0)).getUTCDate()
  return new Date(Date.UTC(year, month - 1 + months, Math.min(day, last))).toISOString().slice(0, 10)
}
/** Today (plus `offset` days) in the user's time zone. */
function localDate(offset: number) {
  const now = new Date()
  now.setDate(now.getDate() + offset)
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

const truthy = new Set(['true', 'yes', 'y', '1', 'x', '✓', '✔', 'checked', 'on', '是', '对'])
const falsy = new Set(['false', 'no', 'n', '0', 'unchecked', 'off', '否', '不'])
const isoDate = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/

const builtinSet = new WeakSet<FieldType>()
const cache = new WeakMap<Messages, ReturnType<typeof makeBuiltinTypes>>()

/** Whether `type` is the built-in type `name` (in any locale). */
export function isBuiltinType(type: FieldType, name: BuiltinTypeName) {
  return builtinSet.has(type) && type.name === name
}

/** The built-in field types with messages in one locale. */
export function builtinTypesFor(messages: Messages = en) {
  let types = cache.get(messages)
  if (!types) {
    types = makeBuiltinTypes(messages)
    for (const type of Object.values(types)) builtinSet.add(type)
    cache.set(messages, types)
  }
  return types
}

function makeBuiltinTypes(m: Messages) {
  const { errors: e, filters: f, bulk: b, quick: q } = m
  const collator = new Intl.Collator(m.locale, { numeric: true, sensitivity: 'base' })
  const compareLocal = (x: string, y: string) => collator.compare(x, y)

  const text = defineFieldType<string>({
    name: 'text',
    parse: input => input === '' ? null : input,
    format: value => value,
    compare: compareLocal,
    filters: {
      contains: { label: f.contains, test: (value, arg: string) => value !== null && value.toLowerCase().includes(String(arg).toLowerCase()) },
      notContains: { label: f.notContains, test: (value, arg: string) => value === null || !value.toLowerCase().includes(String(arg).toLowerCase()) },
      is: { label: f.is, test: (value, arg: string) => value !== null && compareLocal(value, String(arg)) === 0 },
      startsWith: { label: f.startsWith, test: (value, arg: string) => value !== null && value.toLowerCase().startsWith(String(arg).toLowerCase()) },
    },
    bulk: {
      affix: {
        label: b.affix,
        inputs: [{ name: 'prefix', label: b.prefix, kind: 'text' }, { name: 'suffix', label: b.suffix, kind: 'text' }],
        apply: (value, { prefix = '', suffix = '' }) => value === null && !prefix && !suffix ? null : `${prefix}${value ?? ''}${suffix}`,
      },
      replace: {
        label: b.replace,
        inputs: [
          { name: 'find', label: b.find, kind: 'text' },
          { name: 'replacement', label: b.replacement, kind: 'text' },
          { name: 'regex', label: b.regex, kind: 'boolean' },
          { name: 'matchCase', label: b.matchCase, kind: 'boolean' },
        ],
        apply(value, { find = '', replacement = '', regex = false, matchCase = false }) {
          if (value === null || find === '') return value
          let pattern: RegExp
          try {
            pattern = new RegExp(regex ? find : find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'g' : 'gi')
          } catch {
            return { error: e.invalidRegex }
          }
          // Without regex, `$` in the replacement is literal.
          const result = value.replace(pattern, regex ? replacement : () => replacement)
          return result === '' ? null : result
        },
      },
      case: {
        label: b.changeCase,
        inputs: [{ name: 'to', kind: 'choice', choices: [{ value: 'upper', label: b.upper }, { value: 'lower', label: b.lower }, { value: 'title', label: b.title }] }],
        apply(value, { to = '' }) {
          if (value === null) return null
          if (to === 'upper') return value.toUpperCase()
          if (to === 'lower') return value.toLowerCase()
          if (to === 'title') return value.toLowerCase().replace(/(^|\s)\S/g, letter => letter.toUpperCase())
          return { error: e.chooseCase }
        },
      },
    },
    quickActions: () => [
      { label: q.changeCase, items: [
        { label: b.upper, apply: value => value?.toUpperCase() ?? null },
        { label: b.lower, apply: value => value?.toLowerCase() ?? null },
        { label: b.title, apply: value => value?.toLowerCase().replace(/(^|\s)\S/g, letter => letter.toUpperCase()) ?? null },
      ] },
      { label: q.trimSpaces, apply: value => value?.trim().replace(/\s+/g, ' ') || null },
    ],
  })

  const number = defineFieldType<number, NumberOptions>({
    name: 'number',
    parse(input, options) {
      const trimmed = input.trim().replace(/[\s,_，]/g, '')
      if (trimmed === '') return null
      const value = Number(trimmed)
      if (!Number.isFinite(value)) return { error: e.notANumber }
      return options.precision === undefined ? value : Number(value.toFixed(options.precision))
    },
    format: (value, options) => options.precision === undefined ? String(value) : value.toFixed(options.precision),
    compare: (x, y) => x - y,
    validate(value, options) {
      if (options.min !== undefined && value < options.min) return e.atLeast(options.min)
      if (options.max !== undefined && value > options.max) return e.atMost(options.max)
      return undefined
    },
    filters: {
      eq: { label: f.eq, test: (value, arg: number) => value === arg },
      ne: { label: f.ne, test: (value, arg: number) => value !== arg },
      gt: { label: f.gt, test: (value, arg: number) => value !== null && value > arg },
      gte: { label: f.gte, test: (value, arg: number) => value !== null && value >= arg },
      lt: { label: f.lt, test: (value, arg: number) => value !== null && value < arg },
      lte: { label: f.lte, test: (value, arg: number) => value !== null && value <= arg },
    },
    bulk: {
      add: {
        label: b.increaseBy,
        inputs: [{ name: 'amount', kind: 'number' }],
        apply: (value, { amount }, options) => value === null ? null : roundTo(value + Number(amount ?? 0), options.precision),
      },
      multiply: {
        label: b.multiplyBy,
        inputs: [{ name: 'factor', kind: 'number' }],
        apply: (value, { factor }, options) => value === null ? null : roundTo(value * Number(factor ?? 1), options.precision),
      },
    },
    quickActions: ({ precision }) => [
      { label: q.plusOne, apply: value => value === null ? null : roundTo(value + 1, precision) },
      { label: q.minusOne, apply: value => value === null ? null : roundTo(value - 1, precision) },
      { label: precision ? q.roundTo(precision) : q.round, apply: value => value === null ? null : Number(value.toFixed(precision ?? 0)) },
      { label: q.setZero, apply: () => 0, isActive: value => value === 0 },
    ],
  })

  const checkbox = defineFieldType<boolean>({
    name: 'checkbox',
    parse(input) {
      const value = input.trim().toLowerCase()
      if (value === '') return null
      if (truthy.has(value)) return true
      if (falsy.has(value)) return false
      return { error: e.notYesNo }
    },
    format: value => value ? 'TRUE' : 'FALSE',
    compare: (x, y) => Number(x) - Number(y),
    // An unchecked box and an empty one are the same cell.
    isEmpty: value => value === false,
    filters: {
      checked: { label: f.checked, input: 'none', test: value => value === true },
      unchecked: { label: f.unchecked, input: 'none', test: value => value !== true },
    },
    quickActions: () => [
      { label: q.checkAll, apply: () => true, isActive: value => value === true },
      { label: q.uncheckAll, apply: () => false, isActive: value => value !== true },
      { label: q.toggleEach, apply: value => value !== true },
    ],
  })

  /** Calendar date stored as an ISO `YYYY-MM-DD` string. */
  const date = defineFieldType<string>({
    name: 'date',
    parse(input) {
      const trimmed = input.trim()
      if (trimmed === '') return null
      const match = isoDate.exec(trimmed)
      if (!match) return { error: e.dateFormat }
      const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
      const value = new Date(Date.UTC(year, month - 1, day))
      if (value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day) return { error: e.invalidDate }
      return `${match[1]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    },
    compare: (x, y) => x < y ? -1 : x > y ? 1 : 0,
    filters: {
      is: { label: f.is, test: (value, arg: string) => value === arg },
      before: { label: f.before, test: (value, arg: string) => value !== null && value < arg },
      after: { label: f.after, test: (value, arg: string) => value !== null && value > arg },
    },
    bulk: {
      shift: {
        label: b.shiftDays,
        inputs: [{ name: 'days', kind: 'number' }],
        apply: (value, { days }) => value === null ? null : addDays(value, Number(days ?? 0)),
      },
    },
    quickActions: () => [
      { label: q.today, apply: () => localDate(0), isActive: value => value === localDate(0) },
      { label: q.tomorrow, apply: () => localDate(1), isActive: value => value === localDate(1) },
      { label: q.shift, items: [
        { label: q.plusDay, apply: value => value && addDays(value, 1) },
        { label: q.minusDay, apply: value => value && addDays(value, -1) },
        { label: q.plusWeek, apply: value => value && addDays(value, 7) },
        { label: q.minusWeek, apply: value => value && addDays(value, -7) },
        { label: q.plusMonth, apply: value => value && addMonths(value, 1) },
        { label: q.minusMonth, apply: value => value && addMonths(value, -1) },
      ] },
    ],
  })

  const select = defineFieldType<string, SelectOptions>({
    name: 'select',
    parse(input, { options }) {
      if (input.trim() === '') return null
      return matchOption(options, input) ?? { error: e.notAnOption(input.trim()) }
    },
    format: (value, { options }) => labelOf(options, value),
    compare(x, y, { options }) {
      const index = (value: string) => options.findIndex(option => optionValue(option) === value)
      return index(x) - index(y)
    },
    validate: (value, { options }) => options.some(option => optionValue(option) === value) ? undefined : e.notAnOption(value),
    filters: {
      is: { label: f.is, test: (value, arg: string) => value === arg },
      isNot: { label: f.isNot, test: (value, arg: string) => value !== arg },
      isAnyOf: { label: f.isAnyOf, input: 'values', test: (value, arg: string[]) => value !== null && arg.includes(value) },
    },
    quickActions: ({ options }) => [
      { label: q.setTo, items: options.map((option): QuickAction<string, SelectOptions> => ({
        label: optionLabel(option),
        preview: optionValue(option),
        apply: () => optionValue(option),
        isActive: value => value === optionValue(option),
      })) },
    ],
  })

  /** Known options in option order, then new values in the order they were added. */
  const orderTags = (values: Iterable<string>, options: readonly SelectOption[]) => {
    const set = new Set(values)
    const known = options.map(optionValue).filter(entry => set.has(entry))
    return [...known, ...[...set].filter(entry => !known.includes(entry))]
  }

  const multiSelect = defineFieldType<readonly string[], SelectOptions>({
    name: 'multiSelect',
    parse(input, { options, allowCreate }) {
      const entries = input.split(/[,;\n，；、/]/).map(part => part.trim()).filter(Boolean)
      if (entries.length === 0) return null
      const values: string[] = []
      for (const entry of entries) {
        const value = matchOption(options, entry) ?? (allowCreate ? entry : undefined)
        if (value === undefined) return { error: e.notAnOption(entry) }
        if (!values.includes(value)) values.push(value)
      }
      return values
    },
    format: (value, { options }) => value.map(entry => labelOf(options, entry)).join(', '),
    equals: (x, y) => x.length === y.length && x.every((entry, index) => entry === y[index]),
    validate(value, { options, allowCreate }) {
      if (allowCreate) return undefined
      const unknown = value.find(entry => !options.some(option => optionValue(option) === entry))
      return unknown === undefined ? undefined : e.notAnOption(unknown)
    },
    filters: {
      hasAnyOf: { label: f.hasAnyOf, input: 'values', test: (value, arg: string[]) => value !== null && value.some(entry => arg.includes(entry)) },
      hasAllOf: { label: f.hasAllOf, input: 'values', test: (value, arg: string[]) => value !== null && arg.every(entry => value.includes(entry)) },
      hasNoneOf: { label: f.hasNoneOf, input: 'values', test: (value, arg: string[]) => value === null || !value.some(entry => arg.includes(entry)) },
    },
    bulk: {
      add: {
        label: b.addTags,
        inputs: [{ name: 'values', kind: 'values' }],
        apply(value, { values = [] }: { values?: string[] }, { options }) {
          const ordered = orderTags([...(value ?? []), ...values], options)
          return ordered.length ? ordered : null
        },
      },
      remove: {
        label: b.removeTags,
        inputs: [{ name: 'values', kind: 'values' }],
        apply(value, { values = [] }: { values?: string[] }) {
          const next = (value ?? []).filter(entry => !values.includes(entry))
          return next.length ? next : null
        },
      },
    },
    quickActions: ({ options }) => [
      { label: q.add, items: options.map((option): QuickAction<readonly string[], SelectOptions> => ({
        label: optionLabel(option),
        preview: [optionValue(option)],
        apply: value => orderTags([...(value ?? []), optionValue(option)], options),
        isActive: value => value?.includes(optionValue(option)) ?? false,
      })) },
      { label: q.remove, items: options.map((option): QuickAction<readonly string[], SelectOptions> => ({
        label: optionLabel(option),
        preview: [optionValue(option)],
        apply: value => {
          const next = (value ?? []).filter(entry => entry !== optionValue(option))
          return next.length ? next : null
        },
      })) },
      { label: q.removeAll, apply: () => null, isActive: value => value === null },
    ],
  })

  return { text, number, checkbox, date, select, multiSelect } satisfies Record<string, FieldType>
}

/** The English built-in types. */
export const builtinTypes = builtinTypesFor(en)

export type BuiltinTypeName = keyof ReturnType<typeof makeBuiltinTypes>

// Kept for code that imports a type directly.
export const textType = builtinTypes.text
export const numberType = builtinTypes.number
export const checkboxType = builtinTypes.checkbox
export const dateType = builtinTypes.date
export const selectType = builtinTypes.select
export const multiSelectType = builtinTypes.multiSelect

export { compareText }
