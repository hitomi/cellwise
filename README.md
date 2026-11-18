# Cellwise

A spreadsheet-like table editor for React, built around **editing many cells at once**.

**[Live demo →](https://hitomi.github.io/cellwise/)** (try switching to 100,000 rows)

- **Multi-cell editing:** select any cells, including separate ranges with ⌘/Ctrl+click, type a value and press ⌘/Ctrl+Enter to apply it to all of them.
- **Bulk edit panel (⌘/Ctrl+E):** per-column operations such as find and replace, prefix and suffix, increase by, add or remove tags and shift dates, with a live preview before applying.
- **Quick edit from the context menu:** set an option, check, uncheck or toggle, ±1, today, change case and more, applied to the whole selection.
- **Spreadsheet basics:** keyboard navigation, copy and paste with Excel and Google Sheets, drag-to-fill, undo and redo, filter, sort and search.
- **Fast:** rows and columns are virtualized. A cell edit takes microseconds on 100k rows, no matter how long the history is.
- **Typed:** columns are checked against your row type, so a wrong field or wrong options are compile errors.
- **Extensible:** a custom field type is one object.

## Quick start

```sh
pnpm add cellwise react react-dom
```

```tsx
import { DataTable } from 'cellwise'
import 'cellwise/styles.css'

<div style={{ height: 600 }}>
  <DataTable
    data={products}
    columns={[
      { field: 'name', type: 'text', required: true },
      { field: 'price', type: 'number', precision: 2, min: 0 },
      { field: 'status', type: 'select', options: ['Draft', 'Live'] },
      { field: 'tags', type: 'multiSelect', options: ['new', 'sale'] },
      { field: 'active', type: 'checkbox' },
      { field: 'launch', type: 'date' },
    ]}
    onSave={changes => api.save(changes)} // { created, updated, deleted }
  />
</div>
```

Rows are identified by their `id` field; use `rowId="sku"` or `rowId={row => …}` otherwise.
`autoSave={1000}` saves one second after the last edit.

## Saving

`onSave` receives only what changed. It can return the server's versions of the rows (for example
with assigned ids) and row-level errors:

```ts
onSave={async ({ created, updated, deleted }) => {
  const result = await api.save({ created, updated, deleted })
  return {
    created: result.createdRows,                       // same order as `created`
    errors: result.failures.map(f => ({ id: f.id, message: f.reason })),
  }
}}
```

If the save throws, every change is kept so it can be retried. Edits made while a save is in
flight stay unsaved. Invalid cells block saving.

## Custom field types

```tsx
import { defineFieldType } from 'cellwise'

const rating = defineFieldType<number, { max: number }>({
  name: 'rating',
  parse: text => Number(text),                       // typing and paste
  format: value => '★'.repeat(value),                // display and copy
  compare: (a, b) => a - b,                          // sort
  Cell: ({ value, options }) => <Stars value={value} max={options.max} />,
  Editor: ({ value, onCommit }) => <StarPicker value={value} onPick={onCommit} />,
  quickActions: ({ max }) => [{ label: 'Set rating', items: [1, 2, 3, 4, 5].map(n => ({ label: `${n}`, preview: n, apply: () => n })) }],
  bulk: { reset: { label: 'Reset', apply: () => 0 } },
})

columns={[{ field: 'score', type: rating.with({ max: 5 }) }]}
```

Only `name` and `parse` are required. The built-in types (text, number, checkbox, date, select,
multiSelect) use the same interface.

## Control from code

```tsx
const table = useDataTable({ data, columns, onSave })
<DataTable table={table} />

table.undo(); table.save(); table.setFilters([{ field: 'status', operator: 'is', value: 'Live' }])
table.getChanges(); table.subscribe(() => …)
```

`createTable` from `cellwise/core` provides the same store without React.

See [SPEC.md](SPEC.md) for the design and the performance budget.

## Development

```sh
pnpm install
pnpm dev          # demo at http://localhost:5180
pnpm test         # unit tests
pnpm bench        # performance budget (100k rows × 30 columns)
pnpm check        # typecheck
pnpm build        # library → dist/
```

The demo is deployed to GitHub Pages by `.github/workflows/pages.yml` on every push to `main`.

## License

MIT
