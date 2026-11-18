# Cellwise v1 — specification

Cellwise is a spreadsheet-like table editor for React, built around editing many cells at once. In-memory data, single user.
Simple by default, extensible at every level, fast at 100k rows.

## Goals

- **Easy:** `data` + `columns` + `onSave` is a complete, working editor.
- **Extensible:** custom field types are one object; every feature has an escape hatch at its own level.
- **Fast:** cost per user action is independent of history length and close to O(changed cells).
- **Honest scope:** in memory, single user, no realtime collaboration, no server paging (v1).

## Non-goals (v1)

Server-side paging, realtime multi-user editing, formulas, row grouping, variable row height.

## API levels

### Level 1 — works out of the box

```tsx
<DataTable
  data={products}
  columns={[
    { field: 'name', type: 'text' },
    { field: 'price', type: 'number' },
    { field: 'status', type: 'select', options: ['Draft', 'Live'] },
  ]}
  onSave={changes => api.save(changes)}
/>
```

- Row id defaults to the `id` field; `rowId="sku"` or `rowId={row => ...}` overrides it.
- `columns` is checked against the row type: unknown fields, wrong options for a
  type, and type/value mismatches (a `number` column on a string field) are compile errors.

### Level 2 — plain configuration

Column options: `title`, `width`, `pinned`, `readOnly: boolean | (row) => boolean`,
`validate: (value, row) => string | undefined`, `sortable`, `filterable`, plus the
type's own options. Table props: `autoSave` (ms debounce), `onSave`, `createRow`,
`readOnly`, `rowHeight`.

### Level 3 — custom field type

```ts
const rating = defineFieldType<number, { max: number }>({
  name: 'rating',
  parse: text => Number(text),          // typing and paste
  format: value => '★'.repeat(value),   // display and copy
  compare: (a, b) => a - b,             // sort
  Cell: ({ value, options }) => <Stars value={value} max={options.max} />,
  Editor: ({ value, onChange, options }) => <StarPicker />,
})

columns={[{ field: 'score', type: rating.with({ max: 5 }) }]}
```

Built-in types use the same interface. Only `name` and `parse` are required;
everything else has a default.

### Level 4 — control from code

```ts
const table = useDataTable()
<DataTable table={table} ... />
table.undo(); table.save(); table.setFilter([...]); table.getChanges()
table.subscribe(() => ...)
```

UI pieces (toolbar, footer, context menu, empty state) are replaceable via `slots`.

### Level 5 — headless

`createTable(options)` from `cellwise/core` — the same store and commands
with no React.

## Field type interface

```ts
interface FieldType<V, O> {
  name: string
  parse(text: string, options: O): V | null | { error: string }  // null = empty cell
  format?(value: V, options: O): string                          // default String(value)
  equals?(a: V, b: V): boolean                                    // default Object.is
  compare?(a: V, b: V, options: O): number                        // default: by format()
  validate?(value: V, options: O): string | undefined
  filters?: Record<string, FilterOperator<V, O>>
  Cell?: Component<CellProps<V, O>>       // default: format() as text
  Editor?: Component<EditorProps<V, O>>   // default: text input + parse()
}
```

An empty cell is always `null` (`undefined` reads as `null`). Field types never see
empty values in `format`, `equals`, `compare` or `validate`.

Built-in types: `text`, `number`, `checkbox`, `date` (ISO `YYYY-MM-DD`), `select`,
`multiSelect`.

## Data model

- Rows are plain objects, never mutated. An edit replaces the row with a shallow copy.
- Each row has a stable internal key. Existing rows use their id; new rows get a
  temporary key until the save result supplies the real row.
- **Baseline** = last loaded/saved version of each row. **Changes** = current vs baseline,
  computed per field with the type's `equals`.
- **History** = stack of batches of reversible operations (cell patch, insert row,
  delete row). Undo applies the inverse. One user action (paste, fill, delete
  selection) = one batch. Undo after save is allowed and just makes the row dirty again.
- **View** = filter + sort + search produce an ordered list of row keys. The view is
  rebuilt only when filter/sort/search change or data is replaced. Editing a row never
  moves or hides it (Airtable behaviour); new rows appear at the end or at the
  insertion point.

## Saving

```ts
onSave(changes: {
  created: Row[]
  updated: { id: RowId; row: Row; changed: (keyof Row)[] }[]
  deleted: RowId[]
}): void | Promise<void | SaveResult>

type SaveResult = {
  rows?: { key: RowKey; row: Row }[]   // server versions, e.g. assigned ids for created rows
  errors?: { key: RowKey; field?: keyof Row; message: string }[]
}
```

- Created rows carry their temporary key in `created[i]` order and in `SaveResult.rows[].key`.
- Throwing marks the whole save failed; changes remain and can be retried.
- Row `errors` keep only those rows dirty and show the message on the row/cell.
- Edits made while a save is in flight stay dirty against the newly saved baseline.
- `autoSave: ms` saves after the user stops editing for that long.

## Performance budget (enforced by benchmark tests)

| Operation | Budget |
|---|---|
| Single cell edit (store) on 100k rows, any history length | < 1 ms |
| Paste 10k cells | < 100 ms |
| Sort or filter 100k rows | < 150 ms |
| Scroll 100k × 30 | 60 fps (virtualized rows and columns) |

## Packages and entry points

- `cellwise` — `DataTable`, `useDataTable`, `defineFieldType`, types.
- `cellwise/core` — `createTable`, headless.
- `cellwise/styles.css`.

Exports stay small; internal types are not exported.
