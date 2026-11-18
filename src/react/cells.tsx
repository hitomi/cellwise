import { useEffect, useLayoutEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { isBuiltinType, type BuiltinTypeName, type SelectOption, type SelectOptions } from '../core/builtin-types.js'
import type { ResolvedColumn } from '../core/columns.js'
import { isParseError, type EditorProps } from '../core/field-type.js'
import { useMessages } from './messages-context.js'

/** Built-in editors also receive the resolved column, and report drafts the grid can commit. */
export type InternalEditorProps = EditorProps<any, any> & {
  column: ResolvedColumn
  /** The row being edited. */
  row?: unknown
  /** The value the editor would commit now, or why it cannot. */
  onDraft?(draft: { value: unknown } | { error: string }): void
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
/** Platform label for a shortcut: `⌘E` on Apple devices, `Ctrl+E` elsewhere. */
export const shortcut = (key: string) => isMac ? `⌘${key}` : `Ctrl+${key}`

const palette = ['blue', 'green', 'amber', 'purple', 'teal', 'pink', 'red', 'gray']

function optionsOf(column: ResolvedColumn): readonly SelectOption[] {
  return (column.options as SelectOptions).options ?? []
}

function optionInfo(options: readonly SelectOption[], value: string) {
  const index = options.findIndex(option => (typeof option === 'string' ? option : option.value) === value)
  const option = options[index]
  const label = option === undefined ? value : typeof option === 'string' ? option : option.label ?? option.value
  const color = (typeof option === 'object' ? option.color : undefined) ?? palette[(index < 0 ? 7 : index) % palette.length]!
  return { label, color }
}

function Pill({ label, color }: { label: string; color: string }) {
  const named = palette.includes(color)
  return <span className="cw-pill" data-color={named ? color : undefined} style={named ? undefined : { background: color }}>{label}</span>
}

export function isBuiltin(column: ResolvedColumn, name: BuiltinTypeName) {
  return isBuiltinType(column.type, name)
}

/** Cell content for a column and value. */
export function renderCell(column: ResolvedColumn, value: unknown): ReactNode {
  const { type, options } = column
  if (type.Cell) {
    const Cell = type.Cell
    return <Cell value={type.isEmpty(value) ? null : value} options={options} />
  }
  if (isBuiltin(column, 'checkbox')) return <span className="cw-check" data-checked={value === true || undefined} role="checkbox" aria-checked={value === true} />
  if (type.isEmpty(value)) return null
  if (isBuiltin(column, 'select')) return <Pill {...optionInfo(optionsOf(column), value as string)} />
  if (isBuiltin(column, 'multiSelect'))
    return <span className="cw-pills">{(value as string[]).map(entry => <Pill key={entry} {...optionInfo(optionsOf(column), entry)} />)}</span>
  return <span className="cw-text">{type.format(value, options)}</span>
}

export function cellAlign(column: ResolvedColumn) {
  return isBuiltin(column, 'number') ? 'end' : isBuiltin(column, 'checkbox') ? 'center' : undefined
}

/** Editor for a column, or `null` when the cell is toggled instead of edited. */
export function editorFor(column: ResolvedColumn): ComponentType<InternalEditorProps> | null {
  if (column.type.Editor) return column.type.Editor as ComponentType<InternalEditorProps>
  if (isBuiltin(column, 'checkbox')) return null
  if (isBuiltin(column, 'select')) return SelectEditor
  if (isBuiltin(column, 'multiSelect')) return MultiSelectEditor
  return TextEditor
}

/** Text input that parses with the column's type. Works for any field type. */
export function TextEditor({ value, column, initialText, onCommit, onCancel, onDraft }: InternalEditorProps) {
  const [text, setText] = useState(() => initialText ?? (column.type.isEmpty(value) ? '' : column.type.format(value, column.options)))
  const [error, setError] = useState<string>()
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)

  useLayoutEffect(() => {
    const input = ref.current!
    input.focus()
    if (initialText === undefined) input.select()
    else input.setSelectionRange(input.value.length, input.value.length)
  }, [initialText])

  // Report what would be committed, so saving or leaving can commit the open editor.
  const draft = (next: string) => {
    const result = column.type.parse(next, column.options)
    onDraft?.(isParseError(result) ? result : { value: result })
  }
  useLayoutEffect(() => { if (initialText !== undefined) draft(initialText) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function commit(): boolean {
    const result = column.type.parse(text, column.options)
    if (isParseError(result)) {
      setError(result.error)
      return false
    }
    done.current = true
    onCommit(result)
    return true
  }

  return (
    <div className="cw-editor-text">
      <input
        ref={ref}
        className="cw-input"
        aria-label={column.title}
        value={text}
        inputMode={isBuiltin(column, 'number') ? 'decimal' : undefined}
        placeholder={isBuiltin(column, 'date') ? 'YYYY-MM-DD' : undefined}
        style={{ textAlign: cellAlign(column) === 'end' ? 'right' : undefined }}
        onChange={event => { setText(event.target.value); setError(undefined); draft(event.target.value) }}
        onKeyDown={event => {
          if ((event.key === 'Enter' || event.key === 'Tab') && !event.nativeEvent.isComposing) {
            event.preventDefault()
            if (!commit()) event.stopPropagation()
          }
        }}
        onBlur={() => {
          if (done.current) return
          const result = column.type.parse(text, column.options)
          done.current = true
          if (isParseError(result)) onCancel()
          else onCommit(result)
        }}
      />
      {error && <div className="cw-editor-error" role="alert">{error}</div>}
    </div>
  )
}

function useOptionList(column: ResolvedColumn, initialText: string | undefined, selectedIndex: number, extra: readonly string[] = []) {
  const [query, setQuery] = useState(initialText ?? '')
  const options = optionsOf(column)
  const all: string[] = [...options.map(option => typeof option === 'string' ? option : option.value), ...extra.filter(entry => !options.some(option => (typeof option === 'string' ? option : option.value) === entry))]
  const lower = query.trim().toLowerCase()
  const filtered = all.filter(value => !lower || optionInfo(options, value).label.toLowerCase().includes(lower))
  const [active, setActive] = useState(Math.max(0, initialText ? 0 : selectedIndex))
  const clamped = Math.min(active, Math.max(0, filtered.length - 1))
  const input = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => { input.current?.focus() }, [])
  function navigate(event: React.KeyboardEvent, count: number) {
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive(Math.min(clamped + 1, count - 1)); return true }
    if (event.key === 'ArrowUp') { event.preventDefault(); setActive(Math.max(clamped - 1, 0)); return true }
    return false
  }
  return { query, setQuery: (next: string) => { setQuery(next); setActive(0) }, options, filtered, active: clamped, setActive, input, navigate }
}

let listIds = 0
const useListId = () => useState(() => `cw-list-${++listIds}`)[0]

/** An option as shown in a dropdown: the column's own renderer when it has one. */
function OptionContent({ column, value, row }: { column: ResolvedColumn; value: string; row: unknown }) {
  // A multi-select column renders lists of values, so one option is shown as a list of one.
  if (column.render) return <>{column.render(isBuiltin(column, 'multiSelect') ? [value] : value, row)}</>
  return <Pill {...optionInfo(optionsOf(column), value)} />
}

function SelectEditor({ value, column, row, initialText, onCommit, onCancel }: InternalEditorProps) {
  const messages = useMessages()
  const listId = useListId()
  const options = optionsOf(column)
  const list = useOptionList(column, initialText, options.findIndex(option => (typeof option === 'string' ? option : option.value) === value))
  const done = useRef(false)
  const pick = (picked: string | null) => { done.current = true; onCommit(picked) }
  const hasValue = value !== null && value !== undefined && value !== ''
  return (
    <div className="cw-dropdown">
      {/* The current value stays visible beside the search box. */}
      <div className="cw-dropdown-head" onMouseDown={event => { if (event.target !== list.input.current) { event.preventDefault(); list.input.current?.focus() } }}>
        {hasValue && <span className="cw-dropdown-current"><OptionContent column={column} value={String(value)} row={row} /></span>}
        <input
        ref={list.input}
        className="cw-input"
        role="combobox"
        aria-label={column.title}
        aria-expanded="true"
        aria-controls={listId}
        aria-autocomplete="list"
        placeholder={messages.ui.findOption}
        value={list.query}
        onChange={event => list.setQuery(event.target.value)}
        onKeyDown={event => {
          if (list.navigate(event, list.filtered.length) || event.nativeEvent.isComposing) return
          if (event.key === 'Enter' || event.key === 'Tab') {
            event.preventDefault()
            const picked = list.filtered[list.active]
            if (picked !== undefined) pick(picked)
            else if (!list.query) pick(null)
            else event.stopPropagation()
          }
        }}
        onBlur={() => { if (!done.current) onCancel() }}
        />
      </div>
      <div className="cw-dropdown-popup">
      <div className="cw-options" role="listbox" id={listId} aria-label={column.title}>
        {value !== null && value !== undefined && !column.required && (
          <div className="cw-option cw-option-clear" onMouseDown={event => { event.preventDefault(); pick(null) }}>{messages.bulk.clear}</div>
        )}
        {list.filtered.map((optionValue, index) => (
          <div key={optionValue} role="option" aria-selected={optionValue === value} aria-label={optionInfo(options, optionValue).label}
            className="cw-option" data-active={index === list.active || undefined}
            onMouseEnter={() => list.setActive(index)} onMouseDown={event => { event.preventDefault(); pick(optionValue) }}>
            <span className="cw-option-tick" aria-hidden="true">{optionValue === value ? '✓' : ''}</span>
            <OptionContent column={column} value={optionValue} row={row} />
          </div>
        ))}
        {!list.filtered.length && <div className="cw-option-empty">{messages.ui.noMatchingOption}</div>}
      </div>
      </div>
    </div>
  )
}

function MultiSelectEditor({ value, column, row, initialText, onCommit, onChange }: InternalEditorProps) {
  const messages = useMessages()
  const listId = useListId()
  const options = optionsOf(column)
  const allowCreate = (column.options as SelectOptions).allowCreate ?? false
  const [selected, setSelected] = useState<string[]>(() => Array.isArray(value) ? [...value] : [])
  // Values added in this editor (free tags) are listed alongside the options.
  const list = useOptionList(column, initialText, 0, selected)
  const typed = list.query.trim()
  const canCreate = allowCreate && typed !== '' && !list.filtered.some(entry => optionInfo(options, entry).label.toLowerCase() === typed.toLowerCase())
  const ordered = (values: string[]) => {
    const known = options.map(option => typeof option === 'string' ? option : option.value).filter(entry => values.includes(entry))
    const result = [...known, ...values.filter(entry => !known.includes(entry))]
    return result.length ? result : null
  }
  useEffect(() => { onChange(ordered(selected)) }, [selected]) // eslint-disable-line react-hooks/exhaustive-deps
  const done = useRef(false)
  const finish = () => {
    if (done.current) return
    done.current = true
    onCommit(ordered(selected))
  }
  // Clicking elsewhere commits through the input's blur. (Committing on unmount would
  // close the editor at once under React StrictMode, which mounts effects twice.)
  const toggle = (entry: string) => setSelected(current => current.includes(entry) ? current.filter(item => item !== entry) : [...current, entry])
  const createIndex = canCreate ? list.filtered.length : -1
  return (
    <div className="cw-dropdown">
      {/* The selected values stay visible above the list; × removes one. */}
      <div className="cw-dropdown-head" onMouseDown={event => { if (event.target !== list.input.current) { event.preventDefault(); list.input.current?.focus() } }}>
        {selected.map(entry => (
          <span key={entry} className="cw-dropdown-current cw-dropdown-chip">
            <OptionContent column={column} value={entry} row={row} />
            <button type="button" tabIndex={-1} className="cw-chip-remove" aria-label={messages.ui.removeOption(optionInfo(options, entry).label)}
              onMouseDown={event => { event.preventDefault(); event.stopPropagation(); toggle(entry) }}>×</button>
          </span>
        ))}
        <input
        ref={list.input}
        className="cw-input"
        role="combobox"
        aria-label={column.title}
        aria-expanded="true"
        aria-controls={listId}
        aria-autocomplete="list"
        placeholder={messages.ui.findOption}
        value={list.query}
        onChange={event => list.setQuery(event.target.value)}
        onKeyDown={event => {
          if (list.navigate(event, list.filtered.length + (canCreate ? 1 : 0)) || event.nativeEvent.isComposing) return
          if (event.key === 'Enter' && !(event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            event.stopPropagation()
            if (list.active === createIndex) { toggle(typed); list.setQuery(''); return }
            const entry = list.filtered[list.active]
            if (entry !== undefined) { toggle(entry); list.setQuery('') }
          } else if (event.key === 'Tab' || event.key === 'Enter') {
            event.preventDefault()
            finish()
          }
        }}
        onBlur={finish}
        />
      </div>
      <div className="cw-dropdown-popup">
      <div className="cw-options" role="listbox" id={listId} aria-label={column.title} aria-multiselectable>
        {list.filtered.map((entry, index) => (
          <div key={entry} role="option" aria-selected={selected.includes(entry)} aria-label={optionInfo(options, entry).label}
            className="cw-option" data-active={index === list.active || undefined}
            onMouseEnter={() => list.setActive(index)} onMouseDown={event => { event.preventDefault(); toggle(entry) }}>
            <span className="cw-check" data-checked={selected.includes(entry) || undefined} />
            <OptionContent column={column} value={entry} row={row} />
          </div>
        ))}
        {canCreate && (
          <div role="option" aria-selected={false} className="cw-option cw-option-create" data-active={list.active === createIndex || undefined}
            onMouseEnter={() => list.setActive(createIndex)} onMouseDown={event => { event.preventDefault(); toggle(typed); list.setQuery('') }}>
            {messages.ui.createOption(typed)}
          </div>
        )}
      </div>
      <div className="cw-dropdown-hint">{messages.ui.multiSelectHint}</div>
      </div>
    </div>
  )
}
