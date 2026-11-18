import { useEffect, useMemo, useRef, useState } from 'react'
import type { SelectOption, SelectOptions } from '../core/builtin-types.js'
import type { ResolvedColumn } from '../core/columns.js'
import { isParseError, type BulkInput } from '../core/field-type.js'
import type { BulkEdit, CellError, CellRange, EditResult, Table } from '../core/table.js'
import { isBuiltin, shortcut } from './cells.js'

interface BulkEditorProps {
  table: Table<any>
  ranges: CellRange[]
  onClose(result?: EditResult): void
}

type Draft = { operation: string; args: Record<string, unknown>; invalid: Record<string, string> }

/** Dialog that applies one bulk operation per column to every selected cell. */
export function BulkEditor({ table, ranges, onClose }: BulkEditorProps) {
  const columns = table.getColumns()
  // Columns in the selection, with how many selected cells each has.
  const targets = useMemo(() => {
    const counts = new Map<number, number>()
    for (const range of ranges)
      for (let c = range.colStart; c <= range.colEnd; c++) counts.set(c, (counts.get(c) ?? 0) + range.rowEnd - range.rowStart + 1)
    return [...counts].sort(([a], [b]) => a - b).map(([c, count]) => ({ column: columns[c]!, count }))
  }, [ranges, columns])

  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => Object.fromEntries(targets.map(({ column }) => [
    column.field, initialDraft(column, targets.length === 1 ? 'set' : 'keep'),
  ])))
  const update = (field: string, next: Partial<Draft>) => setDrafts(current => ({ ...current, [field]: { ...current[field]!, ...next } }))

  const edits: BulkEdit[] = targets.flatMap(({ column }) => {
    const draft = drafts[column.field]!
    return draft.operation === 'keep' ? [] : [{ field: column.field, operation: draft.operation, args: draft.args }]
  })
  const invalidInputs = targets.some(({ column }) => drafts[column.field]!.operation !== 'keep' && Object.keys(drafts[column.field]!.invalid).length > 0)
  const plan = useMemo(() => table.previewBulkEdit(ranges, edits), [table, ranges, JSON.stringify(edits)]) // eslint-disable-line react-hooks/exhaustive-deps
  const canApply = edits.length > 0 && plan.changes > 0 && !invalidInputs

  const dialog = useRef<HTMLDivElement>(null)
  useEffect(() => { dialog.current?.querySelector('select')?.focus() }, [])

  function apply() {
    if (!canApply) return
    onClose(table.bulkEdit(ranges, edits))
  }

  return (
    <div className="cw-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={dialog} className="cw-modal" role="dialog" aria-modal="true" aria-labelledby="cw-bulk-title"
        onKeyDown={event => {
          if (event.key === 'Escape') { event.stopPropagation(); onClose() }
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); apply() }
        }}>
        <h2 id="cw-bulk-title" className="cw-modal-title">
          Edit {cellTotal(targets).toLocaleString()} selected cells
        </h2>
        <div className="cw-bulk-rows">
          {targets.map(({ column, count }) => {
            const draft = drafts[column.field]!
            const operation = draft.operation === 'keep' ? undefined : column.type.bulk[draft.operation]
            return (
              <div className="cw-bulk-row" key={column.field}>
                <div className="cw-bulk-column">
                  <span className="cw-bulk-title">{column.title}</span>
                  <span className="cw-hint">{count.toLocaleString()} {count === 1 ? 'cell' : 'cells'}</span>
                </div>
                <select className="cw-select" aria-label={`${column.title} operation`} value={draft.operation}
                  onChange={event => update(column.field, initialDraft(column, event.target.value))}>
                  <option value="keep">Keep unchanged</option>
                  {Object.entries(column.type.bulk).map(([name, entry]) => <option key={name} value={name}>{entry.label}</option>)}
                </select>
                <div className="cw-bulk-inputs">
                  {operation?.inputs?.map(input => (
                    <BulkInputField key={`${draft.operation}:${input.name}`} column={column} input={input} value={draft.args[input.name]}
                      error={draft.invalid[input.name]}
                      onChange={(value, error) => {
                        const invalid = { ...draft.invalid }
                        if (error) invalid[input.name] = error
                        else delete invalid[input.name]
                        update(column.field, { args: { ...draft.args, [input.name]: value }, invalid })
                      }} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
        <div className="cw-bulk-preview" role="status">
          {!edits.length ? 'Choose what to change.'
            : invalidInputs ? 'Fix the highlighted inputs.'
              : <PlanSummary changes={plan.changes} unchanged={plan.unchanged} errors={plan.errors} />}
        </div>
        <div className="cw-modal-actions">
          <span className="cw-hint">{shortcut('Enter')} to apply · undo with {shortcut('Z')}</span>
          <span className="cw-spacer" />
          <button type="button" className="cw-button" onClick={() => onClose()}>Cancel</button>
          <button type="button" className="cw-button cw-primary" disabled={!canApply} onClick={apply}>
            {plan.changes && !invalidInputs ? `Change ${plan.changes.toLocaleString()} ${plan.changes === 1 ? 'cell' : 'cells'}` : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Inputs that need a value start out marked as required; checkboxes start unchecked. */
function initialDraft(column: ResolvedColumn, operation: string): Draft {
  const args: Record<string, unknown> = {}
  const invalid: Record<string, string> = {}
  for (const input of column.type.bulk[operation]?.inputs ?? []) {
    if (input.kind === 'boolean' || (input.kind === 'value' && isBuiltin(column, 'checkbox'))) args[input.name] = false
    else if (input.kind === 'values' || (input.kind === 'value' && isBuiltin(column, 'multiSelect'))) args[input.name] = []
    else if (input.kind !== 'text') invalid[input.name] = 'Required'
  }
  return { operation, args, invalid }
}

function cellTotal(targets: { count: number }[]) {
  return targets.reduce((sum, target) => sum + target.count, 0)
}

function PlanSummary({ changes, unchanged, errors }: { changes: number; unchanged: number; errors: CellError[] }) {
  // Group skipped cells by reason.
  const reasons = new Map<string, number>()
  for (const error of errors) reasons.set(error.message, (reasons.get(error.message) ?? 0) + 1)
  return (
    <>
      <strong>{changes.toLocaleString()}</strong> {changes === 1 ? 'cell' : 'cells'} will change
      {unchanged > 0 && <> · {unchanged.toLocaleString()} already match</>}
      {[...reasons].slice(0, 3).map(([reason, count]) => (
        <span key={reason} className="cw-bulk-skipped"> · {count.toLocaleString()} skipped: {reason}</span>
      ))}
    </>
  )
}

function optionList(column: ResolvedColumn): readonly SelectOption[] | undefined {
  return isBuiltin(column, 'select') || isBuiltin(column, 'multiSelect') ? (column.options as SelectOptions).options : undefined
}
const optionValue = (option: SelectOption) => typeof option === 'string' ? option : option.value
const optionLabel = (option: SelectOption) => typeof option === 'string' ? option : option.label ?? option.value

function BulkInputField({ column, input, value, error, onChange }: {
  column: ResolvedColumn
  input: BulkInput
  value: unknown
  error: string | undefined
  onChange(value: unknown, error?: string): void
}) {
  const label = input.label
  const options = optionList(column)
  const wrap = (control: React.ReactNode) => label ? <label className="cw-bulk-input">{label}{control}</label> : control

  if (input.kind === 'boolean' || (input.kind === 'value' && isBuiltin(column, 'checkbox'))) {
    return <label className="cw-bulk-input cw-bulk-check">
      <input type="checkbox" checked={value === true} onChange={event => onChange(event.target.checked)} />
      {label ?? (value === true ? 'Checked' : 'Unchecked')}
    </label>
  }
  if (input.kind === 'choice') {
    return wrap(<select className="cw-select" value={String(value ?? '')} onChange={event => onChange(event.target.value || undefined, event.target.value ? undefined : 'Required')}>
      <option value="">Choose…</option>
      {input.choices?.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
    </select>)
  }
  // Several options: multi-select "set", "add", "remove".
  if (options && (input.kind === 'values' || (input.kind === 'value' && isBuiltin(column, 'multiSelect')))) {
    const selected = Array.isArray(value) ? value as string[] : []
    return (
      <div className="cw-chips" role="group" aria-label={label ?? 'Options'}>
        {options.map(option => {
          const on = selected.includes(optionValue(option))
          return (
            <button key={optionValue(option)} type="button" className="cw-chip" aria-pressed={on}
              onClick={() => {
                const next = on ? selected.filter(entry => entry !== optionValue(option)) : [...selected, optionValue(option)]
                // Keep the column's option order.
                onChange(options.map(optionValue).filter(entry => next.includes(entry)))
              }}>
              {optionLabel(option)}
            </button>
          )
        })}
      </div>
    )
  }
  if (options && input.kind === 'value') {
    return wrap(<select className="cw-select" value={String(value ?? '')} onChange={event => onChange(event.target.value || null)}>
      <option value="">(empty)</option>
      {options.map(option => <option key={optionValue(option)} value={optionValue(option)}>{optionLabel(option)}</option>)}
    </select>)
  }
  if (input.kind === 'number') {
    return wrap(<input className="cw-input-small" type="number" step="any" placeholder={label ?? '0'} data-invalid={error ? true : undefined}
      defaultValue={typeof value === 'number' ? value : ''}
      onChange={event => {
        const text = event.target.value
        onChange(text === '' ? undefined : Number(text), text === '' ? 'Required' : undefined)
      }} />)
  }
  if (input.kind === 'text') {
    return wrap(<input className="cw-input-small" placeholder={label} defaultValue={typeof value === 'string' ? value : ''}
      onChange={event => onChange(event.target.value)} />)
  }
  // A value of the column's own type, typed as text and parsed by the type.
  return wrap(
    <input className="cw-input-small" placeholder={isBuiltin(column, 'date') ? 'YYYY-MM-DD' : 'New value'} title={error}
      data-invalid={error ? true : undefined}
      onChange={event => {
        const parsed = column.type.parse(event.target.value, column.options)
        if (isParseError(parsed)) onChange(undefined, parsed.error)
        else onChange(parsed)
      }} />,
  )
}
