# Cellwise

A spreadsheet-like table editor for React, built around **editing many cells at once**.

**[Live demo →](https://hitomi.github.io/cellwise/)** (try switching to 100,000 rows)

- **Multi-cell editing:** select any cells, including separate ranges with ⌘/Ctrl+click, type a value and press ⌘/Ctrl+Enter to apply it to all of them.
- **Bulk edit panel (⌘/Ctrl+E):** per-column operations such as find and replace, prefix and suffix, increase by, add or remove tags and shift dates, with a live preview before applying.
- **Local drafts:** unsaved changes survive a reload; cells changed on the server since become conflicts.
- **Quick edit from the context menu or the toolbar:** set an option, check, uncheck or toggle, ±1, today, change case and more, applied to the whole selection.
- **Image cells:** one image or a gallery per cell. Drop or paste images straight onto a cell, or use the editor (file picker, drag and drop, URL).
- **Spreadsheet basics:** keyboard navigation, copy and paste with Excel and Google Sheets, drag-to-fill, undo and redo, filter, sort and search.
- **Fast:** rows and columns are virtualized. A cell edit takes microseconds on 100k rows, no matter how long the history is.
- **Live data:** pass newer rows any time. Unsaved edits are kept, and a value someone else changed while you were editing becomes a conflict you settle before saving.
- **Localized:** English by default, Chinese with `cellwise/locales/zh-CN`, or your own messages.
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

## Live data and conflicts

Give the table newer rows whenever your source changes (a query cache, a subscription, a local
database). With `useDataTable` or `<DataTable data={rows}>` this happens automatically when `data`
changes; with a table object call `table.syncData(rows)`.

- Cells you have not edited take the new value.
- Cells you edited keep your value.
- If the source changed a cell you also edited, the cell is marked as a **conflict**. Right-click it
  to keep your value or use the latest one. Saving waits until conflicts are settled.
- `dependsOn` makes a cell conflict when related fields change, e.g. an edited stock count when an
  order holds stock at the same time:

```ts
{ field: 'available', type: 'number', dependsOn: ['held', 'onHand'] }
```

`table.setData(rows)` replaces everything instead (and clears unsaved changes).

## Local drafts

Unsaved changes can survive a reload or a closed tab:

```tsx
const table = useDataTable({
  data, columns, onSave,
  draft: { key: `products:${userId}`, ready: !isLoading, onRestore: result => toast(`Restored ${result.cells} edits`) },
})
```

Changes are written to `localStorage` (or `storage`) 500 ms after each edit and when the page is
hidden, and applied again once the data is loaded (`ready`, by default once `data` has rows).
Saving or discarding clears the draft; drafts older than `maxAge` (7 days) are dropped.

A restored edit whose cell changed on the server in the meantime becomes a **conflict** instead of
overwriting the newer value. Rows that are gone and cells that became read-only are skipped.
Values that cannot be stored, such as images not uploaded yet, are left out. Restored changes are
not an undo step.

For your own storage (IndexedDB, a server), use `table.getDraft()` (plain JSON, or `null`) and
`table.restoreDraft(draft)`.

## Computed columns and custom cells

```ts
{ key: 'total', title: 'Total', type: 'number', precision: 2, value: row => row.price * row.quantity }
{ field: 'status', type: 'select', options, render: (value, row) => <StatusPill status={value} /> }
{ field: 'status', type: 'select', options, clickToEdit: true } // open on any click (by default, releasing on the ▾ in the cell opens it; a drag from it selects)
```

Computed columns are read-only and sort, filter, search and copy like any other column.

More column options:

```ts
{ field: 'name', type: 'text', pinned: true }                    // stays visible when scrolling sideways
{ field: 'tags', type: 'multiSelect', options, allowCreate: true } // free tags, options are suggestions
{ field: 'status', type: 'select', options, headerAction: <FilterButton /> } // extra header control
```

## Localization

```tsx
import { zhCN } from 'cellwise/locales/zh-CN'
<DataTable messages={zhCN} ... />
// or override single texts:
<DataTable messages={{ ui: { save: 'Publish' } }} ... />
```

## Toolbar and saving from your own UI

```tsx
<DataTable
  toolbar={{ filter: false, addRow: false, end: <NoteInput />, saveLabel: n => `Save (${n})` }}
  onSaved={outcome => outcome.status === 'saved' && toast('Saved')}
/>
```

Every part is on by default: `search`, `filter`, `sort`, `addRow`, `undo`, `discard` (drops all
unsaved changes; undo brings them back) and `quickActions` (the **Quick edit ▾** menu, shown when
the selected columns have quick edits); pass `false` to hide one.

`table.save()` commits the open editor first, so a value still being typed is saved too. For a
navigation guard, call `table.commitEdit()` and then check `table.getStatus()`
(`changedRows`, `editing`, `saving`). Other useful calls: `table.discardChanges()`,
`table.select(range)`, `table.setRowFilter(row => …)`, and the options `canDeleteRow`,
`duplicateRow`, `canInsertRows` and `searchText`.

`onSave` receives `updated[].original`, the row as last loaded or saved, for optimistic
concurrency checks on your server. Pass `onNotice` to show the table's short messages (a skipped
paste, a blocked save) in your own toast instead of the status bar.

## Image cells

```tsx
import { createImageType } from 'cellwise'

// `upload` returns the stored file's URL, e.g. after uploading to S3. Without it, images are kept as data URLs.
const photo = createImageType({ upload })                                // field: string
const gallery = createImageType({ multiple: true, maxCount: 6, upload }) // field: string[]

columns={[{ field: 'photo', type: photo }, { field: 'gallery', type: gallery }]}
```

Drop image files onto a cell, or paste one with ⌘/Ctrl+V. A single image is replaced; a gallery
appends as many as fit. Enter opens the editor, where you can add, remove, drop, paste or enter URLs.
Any field type can accept files through the `files` option of `defineFieldType`. Set
`allowUrls: false` to hide the URL field when images must be uploaded.

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
