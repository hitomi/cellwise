import { compareText, defineFieldType, type FieldType, type QuickAction } from './field-type.js'

export type SelectOption = string | { value: string; label?: string; color?: string }

export interface NumberOptions {
  /** Fixed number of decimals for display and parsing. */
  precision?: number
  min?: number
  max?: number
}
export interface SelectOptions { options: readonly SelectOption[] }

const optionValue = (option: SelectOption) => typeof option === 'string' ? option : option.value
const optionLabel = (option: SelectOption) => typeof option === 'string' ? option : option.label ?? option.value

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

export const textType = defineFieldType<string>({
  name: 'text',
  quickActions: () => [
    { label: 'Change case', items: [
      { label: 'UPPERCASE', apply: value => value?.toUpperCase() ?? null },
      { label: 'lowercase', apply: value => value?.toLowerCase() ?? null },
      { label: 'Title Case', apply: value => value?.toLowerCase().replace(/(^|\s)\S/g, letter => letter.toUpperCase()) ?? null },
    ] },
    { label: 'Trim spaces', apply: value => value?.trim().replace(/\s+/g, ' ') || null },
  ],
  parse: text => text === '' ? null : text,
  format: value => value,
  compare: compareText,
  filters: {
    contains: { label: 'contains', test: (value, arg: string) => value !== null && value.toLowerCase().includes(String(arg).toLowerCase()) },
    notContains: { label: 'does not contain', test: (value, arg: string) => value === null || !value.toLowerCase().includes(String(arg).toLowerCase()) },
    is: { label: 'is', test: (value, arg: string) => value !== null && compareText(value, String(arg)) === 0 },
    startsWith: { label: 'starts with', test: (value, arg: string) => value !== null && value.toLowerCase().startsWith(String(arg).toLowerCase()) },
  },
  bulk: {
    affix: {
      label: 'Add prefix / suffix',
      inputs: [{ name: 'prefix', label: 'Prefix', kind: 'text' }, { name: 'suffix', label: 'Suffix', kind: 'text' }],
      apply: (value, { prefix = '', suffix = '' }) => value === null && !prefix && !suffix ? null : `${prefix}${value ?? ''}${suffix}`,
    },
    replace: {
      label: 'Find and replace',
      inputs: [
        { name: 'find', label: 'Find', kind: 'text' },
        { name: 'replacement', label: 'Replace with', kind: 'text' },
        { name: 'regex', label: 'Regular expression', kind: 'boolean' },
        { name: 'matchCase', label: 'Match case', kind: 'boolean' },
      ],
      apply(value, { find = '', replacement = '', regex = false, matchCase = false }) {
        if (value === null || find === '') return value
        let pattern: RegExp
        try {
          pattern = new RegExp(regex ? find : find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'g' : 'gi')
        } catch {
          return { error: 'Invalid regular expression' }
        }
        // Without regex, `$` in the replacement is literal.
        const result = value.replace(pattern, regex ? replacement : () => replacement)
        return result === '' ? null : result
      },
    },
    case: {
      label: 'Change case',
      inputs: [{ name: 'to', kind: 'choice', choices: [
        { value: 'upper', label: 'UPPERCASE' }, { value: 'lower', label: 'lowercase' }, { value: 'title', label: 'Title Case' },
      ] }],
      apply(value, { to = '' }) {
        if (value === null) return null
        const mode = String(to).trim().toLowerCase()
        if (mode.startsWith('u')) return value.toUpperCase()
        if (mode.startsWith('l')) return value.toLowerCase()
        if (mode.startsWith('t')) return value.toLowerCase().replace(/(^|\s)\S/g, letter => letter.toUpperCase())
        return { error: 'Choose upper, lower or title' }
      },
    },
  },
})

export const numberType = defineFieldType<number, NumberOptions>({
  name: 'number',
  quickActions: ({ precision }) => [
    { label: '+1', apply: value => value === null ? null : roundTo(value + 1, precision) },
    { label: '−1', apply: value => value === null ? null : roundTo(value - 1, precision) },
    { label: precision ? `Round to ${precision} decimals` : 'Round', apply: value => value === null ? null : Number(value.toFixed(precision ?? 0)) },
    { label: 'Set to 0', apply: () => 0, isActive: value => value === 0 },
  ],
  parse(text, options) {
    const trimmed = text.trim().replace(/[\s,_]/g, '')
    if (trimmed === '') return null
    const value = Number(trimmed)
    if (!Number.isFinite(value)) return { error: 'Not a number' }
    return options.precision === undefined ? value : Number(value.toFixed(options.precision))
  },
  format: (value, options) => options.precision === undefined ? String(value) : value.toFixed(options.precision),
  compare: (a, b) => a - b,
  validate(value, options) {
    if (options.min !== undefined && value < options.min) return `Must be at least ${options.min}`
    if (options.max !== undefined && value > options.max) return `Must be at most ${options.max}`
    return undefined
  },
  filters: {
    eq: { label: '=', test: (value, arg: number) => value === arg },
    ne: { label: '≠', test: (value, arg: number) => value !== arg },
    gt: { label: '>', test: (value, arg: number) => value !== null && value > arg },
    gte: { label: '≥', test: (value, arg: number) => value !== null && value >= arg },
    lt: { label: '<', test: (value, arg: number) => value !== null && value < arg },
    lte: { label: '≤', test: (value, arg: number) => value !== null && value <= arg },
  },
  bulk: {
    add: {
      label: 'Increase by',
      inputs: [{ name: 'amount', kind: 'number' }],
      apply: (value, { amount }, options) => value === null ? null : roundTo(value + Number(amount ?? 0), options.precision),
    },
    multiply: {
      label: 'Multiply by',
      inputs: [{ name: 'factor', kind: 'number' }],
      apply: (value, { factor }, options) => value === null ? null : roundTo(value * Number(factor ?? 1), options.precision),
    },
  },
})

/** Round to the column's precision, and remove floating-point noise such as 0.1 + 0.2. */
function roundTo(value: number, precision: number | undefined) {
  return precision === undefined ? Number(value.toPrecision(12)) : Number(value.toFixed(precision))
}

const truthy = new Set(['true', 'yes', 'y', '1', 'x', '✓', '✔', 'checked', 'on'])
const falsy = new Set(['false', 'no', 'n', '0', 'unchecked', 'off'])

export const checkboxType = defineFieldType<boolean>({
  name: 'checkbox',
  quickActions: () => [
    { label: 'Check all', apply: () => true, isActive: value => value === true },
    { label: 'Uncheck all', apply: () => false, isActive: value => value !== true },
    { label: 'Toggle each', apply: value => value !== true },
  ],
  parse(text) {
    const value = text.trim().toLowerCase()
    if (value === '') return null
    if (truthy.has(value)) return true
    if (falsy.has(value)) return false
    return { error: 'Not a yes/no value' }
  },
  format: value => value ? 'TRUE' : 'FALSE',
  compare: (a, b) => Number(a) - Number(b),
  // An unchecked box and an empty one are the same cell.
  isEmpty: value => value === false,
  filters: {
    checked: { label: 'is checked', input: 'none', test: value => value === true },
    unchecked: { label: 'is not checked', input: 'none', test: value => value !== true },
  },
})

const isoDate = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/

/** Calendar date stored as an ISO `YYYY-MM-DD` string. */
export const dateType = defineFieldType<string>({
  name: 'date',
  quickActions: () => [
    { label: 'Today', apply: () => localDate(0), isActive: value => value === localDate(0) },
    { label: 'Tomorrow', apply: () => localDate(1), isActive: value => value === localDate(1) },
    { label: 'Shift', items: [
      { label: '+1 day', apply: value => value && addDays(value, 1) },
      { label: '−1 day', apply: value => value && addDays(value, -1) },
      { label: '+1 week', apply: value => value && addDays(value, 7) },
      { label: '−1 week', apply: value => value && addDays(value, -7) },
      { label: '+1 month', apply: value => value && addMonths(value, 1) },
      { label: '−1 month', apply: value => value && addMonths(value, -1) },
    ] },
  ],
  parse(text) {
    const trimmed = text.trim()
    if (trimmed === '') return null
    const match = isoDate.exec(trimmed)
    if (!match) return { error: 'Use YYYY-MM-DD' }
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
    const date = new Date(Date.UTC(year, month - 1, day))
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return { error: 'Not a valid date' }
    return `${match[1]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  },
  compare: (a, b) => a < b ? -1 : a > b ? 1 : 0,
  filters: {
    is: { label: 'is', test: (value, arg: string) => value === arg },
    before: { label: 'is before', test: (value, arg: string) => value !== null && value < arg },
    after: { label: 'is after', test: (value, arg: string) => value !== null && value > arg },
  },
  bulk: {
    shift: {
      label: 'Shift by days',
      inputs: [{ name: 'days', kind: 'number' }],
      apply: (value, { days }) => value === null ? null : addDays(value, Number(days ?? 0)),
    },
  },
})

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

export const selectType = defineFieldType<string, SelectOptions>({
  name: 'select',
  quickActions: ({ options }) => [
    { label: 'Set to', items: options.map((option): QuickAction<string, SelectOptions> => ({
      label: optionLabel(option),
      preview: optionValue(option),
      apply: () => optionValue(option),
      isActive: value => value === optionValue(option),
    })) },
  ],
  parse(text, { options }) {
    if (text.trim() === '') return null
    return matchOption(options, text) ?? { error: `"${text.trim()}" is not an option` }
  },
  format: (value, { options }) => labelOf(options, value),
  compare(a, b, { options }) {
    const index = (value: string) => options.findIndex(option => optionValue(option) === value)
    return index(a) - index(b)
  },
  validate: (value, { options }) => options.some(option => optionValue(option) === value) ? undefined : `"${value}" is not an option`,
  filters: {
    is: { label: 'is', test: (value, arg: string) => value === arg },
    isNot: { label: 'is not', test: (value, arg: string) => value !== arg },
    isAnyOf: { label: 'is any of', input: 'values', test: (value, arg: string[]) => value !== null && arg.includes(value) },
  },
})

export const multiSelectType = defineFieldType<readonly string[], SelectOptions>({
  name: 'multiSelect',
  quickActions: ({ options }) => [
    { label: 'Add', items: options.map((option): QuickAction<readonly string[], SelectOptions> => ({
      label: optionLabel(option),
      preview: [optionValue(option)],
      apply: value => {
        const next = new Set([...(value ?? []), optionValue(option)])
        return options.map(optionValue).filter(entry => next.has(entry))
      },
      isActive: value => value?.includes(optionValue(option)) ?? false,
    })) },
    { label: 'Remove', items: options.map((option): QuickAction<readonly string[], SelectOptions> => ({
      label: optionLabel(option),
      preview: [optionValue(option)],
      apply: value => {
        const next = (value ?? []).filter(entry => entry !== optionValue(option))
        return next.length ? next : null
      },
    })) },
    { label: 'Remove all', apply: () => null, isActive: value => value === null },
  ],
  parse(text, { options }) {
    const parts = text.split(/[,;\n]/).map(part => part.trim()).filter(Boolean)
    if (parts.length === 0) return null
    const values: string[] = []
    for (const part of parts) {
      const value = matchOption(options, part)
      if (value === undefined) return { error: `"${part}" is not an option` }
      if (!values.includes(value)) values.push(value)
    }
    return values
  },
  format: (value, { options }) => value.map(entry => labelOf(options, entry)).join(', '),
  equals: (a, b) => a.length === b.length && a.every((entry, index) => entry === b[index]),
  validate(value, { options }) {
    const unknown = value.find(entry => !options.some(option => optionValue(option) === entry))
    return unknown === undefined ? undefined : `"${unknown}" is not an option`
  },
  filters: {
    hasAnyOf: { label: 'has any of', input: 'values', test: (value, arg: string[]) => value !== null && value.some(entry => arg.includes(entry)) },
    hasAllOf: { label: 'has all of', input: 'values', test: (value, arg: string[]) => value !== null && arg.every(entry => value.includes(entry)) },
    hasNoneOf: { label: 'has none of', input: 'values', test: (value, arg: string[]) => value === null || !value.some(entry => arg.includes(entry)) },
  },
  bulk: {
    add: {
      label: 'Add',
      inputs: [{ name: 'values', kind: 'values' }],
      apply(value, { values = [] }: { values?: string[] }, { options }) {
        const next = new Set([...(value ?? []), ...values])
        const ordered = options.map(optionValue).filter(entry => next.has(entry))
        return ordered.length ? ordered : null
      },
    },
    remove: {
      label: 'Remove',
      inputs: [{ name: 'values', kind: 'values' }],
      apply(value, { values = [] }: { values?: string[] }) {
        const next = (value ?? []).filter(entry => !values.includes(entry))
        return next.length ? next : null
      },
    },
  },
})

export const builtinTypes = {
  text: textType,
  number: numberType,
  checkbox: checkboxType,
  date: dateType,
  select: selectType,
  multiSelect: multiSelectType,
} satisfies Record<string, FieldType>

export type BuiltinTypeName = keyof typeof builtinTypes
