import { useEffect, useLayoutEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { builtinTypes, type SelectOption, type SelectOptions } from '../core/builtin-types.js'
import type { ResolvedColumn } from '../core/columns.js'
import { isParseError, type EditorProps } from '../core/field-type.js'

/** Built-in editors also receive the resolved column. */
export type InternalEditorProps = EditorProps<any, any> & { column: ResolvedColumn }

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

export function isBuiltin(column: ResolvedColumn, name: keyof typeof builtinTypes) {
  return column.type === builtinTypes[name]
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
export function TextEditor({ value, column, initialText, onCommit, onCancel }: InternalEditorProps) {
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
        value={text}
        inputMode={isBuiltin(column, 'number') ? 'decimal' : undefined}
        placeholder={isBuiltin(column, 'date') ? 'YYYY-MM-DD' : undefined}
        style={{ textAlign: cellAlign(column) === 'end' ? 'right' : undefined }}
        onChange={event => { setText(event.target.value); setError(undefined) }}
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

function useOptionList(column: ResolvedColumn, initialText: string | undefined, selectedIndex: number) {
  const [query, setQuery] = useState(initialText ?? '')
  const options = optionsOf(column)
  const lower = query.trim().toLowerCase()
  const filtered = options.filter(option => {
    const { label } = optionInfo(options, typeof option === 'string' ? option : option.value)
    return !lower || label.toLowerCase().includes(lower)
  })
  const [active, setActive] = useState(Math.max(0, initialText ? 0 : selectedIndex))
  const clamped = Math.min(active, Math.max(0, filtered.length - 1))
  const input = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => { input.current?.focus() }, [])
  const valueAt = (index: number) => {
    const option = filtered[index]
    return option === undefined ? undefined : typeof option === 'string' ? option : option.value
  }
  function navigate(event: React.KeyboardEvent) {
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive(Math.min(clamped + 1, filtered.length - 1)); return true }
    if (event.key === 'ArrowUp') { event.preventDefault(); setActive(Math.max(clamped - 1, 0)); return true }
    return false
  }
  return { query, setQuery: (next: string) => { setQuery(next); setActive(0) }, options, filtered, active: clamped, setActive, input, valueAt, navigate }
}

function SelectEditor({ value, column, initialText, onCommit, onCancel }: InternalEditorProps) {
  const options = optionsOf(column)
  const list = useOptionList(column, initialText, options.findIndex(option => (typeof option === 'string' ? option : option.value) === value))
  const done = useRef(false)
  const pick = (picked: string | null) => { done.current = true; onCommit(picked) }
  return (
    <div className="cw-dropdown">
      <input
        ref={list.input}
        className="cw-input"
        placeholder="Find an option"
        value={list.query}
        onChange={event => list.setQuery(event.target.value)}
        onKeyDown={event => {
          if (list.navigate(event) || event.nativeEvent.isComposing) return
          if (event.key === 'Enter' || event.key === 'Tab') {
            event.preventDefault()
            const picked = list.valueAt(list.active)
            if (picked !== undefined) pick(picked)
            else if (!list.query) pick(null)
            else event.stopPropagation()
          }
        }}
        onBlur={() => { if (!done.current) onCancel() }}
      />
      <div className="cw-options" role="listbox">
        {value !== null && value !== undefined && (
          <div className="cw-option cw-option-clear" onMouseDown={event => { event.preventDefault(); pick(null) }}>Clear</div>
        )}
        {list.filtered.map((option, index) => {
          const optionValue = typeof option === 'string' ? option : option.value
          return (
            <div key={optionValue} role="option" aria-selected={optionValue === value} className="cw-option" data-active={index === list.active || undefined}
              onMouseEnter={() => list.setActive(index)} onMouseDown={event => { event.preventDefault(); pick(optionValue) }}>
              <Pill {...optionInfo(options, optionValue)} />
            </div>
          )
        })}
        {!list.filtered.length && <div className="cw-option-empty">No matching option</div>}
      </div>
    </div>
  )
}

function MultiSelectEditor({ value, column, initialText, onCommit }: InternalEditorProps) {
  const options = optionsOf(column)
  const [selected, setSelected] = useState<string[]>(() => Array.isArray(value) ? [...value] : [])
  const list = useOptionList(column, initialText, 0)
  const done = useRef(false)
  const finish = () => {
    if (done.current) return
    done.current = true
    // Keep the option order from the column definition.
    const ordered = options.map(option => typeof option === 'string' ? option : option.value).filter(entry => selected.includes(entry))
    onCommit(ordered.length ? ordered : null)
  }
  const toggle = (entry: string) => setSelected(current => current.includes(entry) ? current.filter(item => item !== entry) : [...current, entry])
  // Commit when the editor closes by clicking elsewhere.
  const latest = useRef(finish)
  latest.current = finish
  useEffect(() => () => latest.current(), [])
  return (
    <div className="cw-dropdown">
      <input
        ref={list.input}
        className="cw-input"
        placeholder="Find an option"
        value={list.query}
        onChange={event => list.setQuery(event.target.value)}
        onKeyDown={event => {
          if (list.navigate(event) || event.nativeEvent.isComposing) return
          if (event.key === 'Enter' && !(event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            event.stopPropagation()
            const entry = list.valueAt(list.active)
            if (entry !== undefined) { toggle(entry); list.setQuery('') }
          } else if (event.key === 'Tab' || event.key === 'Enter') {
            event.preventDefault()
            finish()
          }
        }}
        onBlur={finish}
      />
      <div className="cw-options" role="listbox" aria-multiselectable>
        {list.filtered.map((option, index) => {
          const entry = typeof option === 'string' ? option : option.value
          return (
            <div key={entry} role="option" aria-selected={selected.includes(entry)} className="cw-option" data-active={index === list.active || undefined}
              onMouseEnter={() => list.setActive(index)} onMouseDown={event => { event.preventDefault(); toggle(entry) }}>
              <span className="cw-check" data-checked={selected.includes(entry) || undefined} />
              <Pill {...optionInfo(options, entry)} />
            </div>
          )
        })}
      </div>
      <div className="cw-dropdown-hint">Enter toggles · Tab to finish</div>
    </div>
  )
}
