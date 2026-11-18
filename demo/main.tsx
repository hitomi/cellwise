import { StrictMode, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createImageType, DataTable, defineColumns, defineFieldType, type TableChanges } from '../src/index.js'
import '../src/styles.css'
import './demo.css'

// ---- a custom field type: 1–5 star rating ----------------------------------

const rating = defineFieldType<number, { max: number }>({
  name: 'rating',
  parse(text, { max }) {
    const trimmed = text.trim()
    if (trimmed === '') return null
    const stars = /^★+$/.test(trimmed) ? trimmed.length : Number(trimmed)
    return Number.isInteger(stars) && stars >= 0 && stars <= max ? stars : { error: `Enter 0–${max}` }
  },
  format: value => '★'.repeat(value),
  compare: (a, b) => a - b,
  filters: {
    atLeast: { label: 'at least', test: (value, arg: number) => value !== null && value >= arg },
  },
  // Right-click → Set rating ▸ shows the stars themselves.
  quickActions: ({ max }) => [
    { label: 'Set rating', items: Array.from({ length: max }, (_, index) => ({
      label: `${index + 1} stars`, preview: index + 1, apply: () => index + 1, isActive: (value: number | null) => value === index + 1,
    })) },
  ],
  Cell: ({ value, options }) => (
    <span className="stars" aria-label={`${value ?? 0} of ${options.max} stars`}>
      {Array.from({ length: options.max }, (_, index) => <span key={index} data-on={index < (value ?? 0) || undefined}>★</span>)}
    </span>
  ),
  Editor: ({ value, options, onCommit, onCancel }) => (
    <div className="stars-editor" tabIndex={-1} ref={element => element?.focus()} onBlur={onCancel}
      onKeyDown={event => {
        const digit = Number(event.key)
        if (Number.isInteger(digit) && digit <= options.max) { event.preventDefault(); onCommit(digit || null) }
      }}>
      {Array.from({ length: options.max }, (_, index) => (
        <button key={index} type="button" data-on={index < (value ?? 0) || undefined} onMouseDown={event => { event.preventDefault(); onCommit(index + 1) }}>★</button>
      ))}
      <button type="button" className="stars-clear" onMouseDown={event => { event.preventDefault(); onCommit(null) }}>Clear</button>
    </div>
  ),
})

// ---- image cells: one photo, or a gallery of up to 6 ------------------------------

// Stand-in for a real upload (e.g. to S3): waits a moment, then returns a local URL.
async function fakeUpload(file: File) {
  await new Promise(resolve => setTimeout(resolve, 800))
  return URL.createObjectURL(file)
}
const photoType = createImageType({ upload: fakeUpload })
const galleryType = createImageType({ multiple: true, maxCount: 6, upload: fakeUpload })

/** Small generated product pictures, so the demo needs no image hosting. */
const sampleImages = ['#2563eb', '#7c3aed', '#0d9488', '#d97706', '#db2777', '#16a34a', '#475569', '#dc2626'].flatMap((color, index) =>
  ['M18 44 32 20l14 24Z', 'M20 20h24v24H20Z', 'M32 18a14 14 0 1 0 0 28 14 14 0 0 0 0-28Z'].map(shape =>
    'data:image/svg+xml,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${color}" opacity="0.18"/>`
      + `<path d="${shape}" fill="${color}" transform="rotate(${index * 15} 32 32)"/></svg>`,
    )))

// ---- data ----------------------------------------------------------------------

type Product = {
  id: number
  name: string
  sku: string
  category: string
  tags: string[]
  price: number | null
  stock: number | null
  active: boolean
  launch: string | null
  rating: number | null
  photo: string | null
  gallery: string[]
  notes: string
}

const categories = [
  { value: 'hardware', label: 'Hardware', color: 'blue' },
  { value: 'software', label: 'Software', color: 'purple' },
  { value: 'service', label: 'Service', color: 'teal' },
  { value: 'accessory', label: 'Accessory', color: 'amber' },
]
const tags = ['new', 'sale', 'bestseller', 'limited', 'eco']

const columns = defineColumns<Product>([
  { field: 'photo', type: photoType, title: 'Photo', width: 64, sortable: false },
  { field: 'name', type: 'text', title: 'Name', width: 220, required: true },
  { field: 'sku', type: 'text', title: 'SKU', width: 120, readOnly: true },
  { field: 'category', type: 'select', title: 'Category', options: categories, width: 140 },
  { field: 'tags', type: 'multiSelect', title: 'Tags', options: tags, width: 200 },
  { field: 'price', type: 'number', title: 'Price', precision: 2, min: 0, width: 110 },
  { field: 'stock', type: 'number', title: 'Stock', min: 0, width: 100, readOnly: row => !row.active },
  { field: 'active', type: 'checkbox', title: 'Active', width: 80 },
  { field: 'launch', type: 'date', title: 'Launch', width: 130 },
  { field: 'rating', type: rating.with({ max: 5 }), title: 'Rating', width: 130 },
  { field: 'gallery', type: galleryType, title: 'Gallery (up to 6)', width: 150 },
  { field: 'notes', type: 'text', title: 'Notes', width: 260 },
])

const words = ['Aurora', 'Nimbus', 'Vector', 'Quartz', 'Pulse', 'Atlas', 'Echo', 'Zenith', 'Orbit', 'Nova', 'Summit', 'Drift']
const kinds = ['Keyboard', 'Monitor', 'License', 'Support plan', 'Cable', 'Dock', 'Headset', 'Router', 'Subscription', 'Mouse']

function makeRows(count: number): Product[] {
  let seed = 7
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  return Array.from({ length: count }, (_, index) => {
    const pick = <T,>(list: readonly T[]) => list[Math.floor(random() * list.length)]!
    const active = random() > 0.2
    return {
      id: index + 1,
      name: `${pick(words)} ${pick(kinds)}`,
      sku: `SKU-${String(index + 1).padStart(6, '0')}`,
      category: pick(categories).value,
      tags: tags.filter(() => random() > 0.75),
      price: random() > 0.05 ? Math.round(random() * 200000) / 100 : null,
      stock: active ? Math.floor(random() * 500) : null,
      active,
      launch: random() > 0.1 ? `202${Math.floor(random() * 6)}-${String(1 + Math.floor(random() * 12)).padStart(2, '0')}-${String(1 + Math.floor(random() * 28)).padStart(2, '0')}` : null,
      rating: random() > 0.3 ? 1 + Math.floor(random() * 5) : null,
      photo: random() > 0.15 ? pick(sampleImages) : null,
      gallery: sampleImages.filter(() => random() > 0.85).slice(0, 6),
      notes: random() > 0.7 ? 'Check supplier lead time' : '',
    }
  })
}

// ---- app -------------------------------------------------------------------------

type LogEntry = { at: string; summary: string; detail: string; failed?: boolean }
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

function App() {
  const [size, setSize] = useState(1000)
  const data = useMemo(() => makeRows(size), [size])
  const [autoSave, setAutoSave] = useState(false)
  const [failNext, setFailNext] = useState(false)
  const [log, setLog] = useState<LogEntry[]>([])
  const [nextId] = useState(() => ({ value: 1_000_000 }))

  async function onSave(changes: TableChanges<Product>) {
    await wait(600)
    const summary = `${changes.created.length} created · ${changes.updated.length} updated · ${changes.deleted.length} deleted`
    const at = new Date().toLocaleTimeString()
    if (failNext) {
      setFailNext(false)
      setLog(entries => [{ at, summary, detail: 'Server unavailable', failed: true }, ...entries].slice(0, 20))
      throw new Error('Server unavailable')
    }
    const detail = JSON.stringify({
      created: changes.created.map(row => row.name),
      updated: changes.updated.map(entry => ({ id: entry.id, changed: entry.changed })),
      deleted: changes.deleted,
    }, null, 1)
    setLog(entries => [{ at, summary, detail }, ...entries].slice(0, 20))
    // The server assigns ids to created rows.
    return { created: changes.created.map(row => ({ ...row, id: nextId.value++ })) }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Cellwise</h1>
        <label>Rows
          <select value={size} onChange={event => setSize(Number(event.target.value))}>
            <option value={1000}>1,000</option>
            <option value={100000}>100,000</option>
          </select>
        </label>
        <label><input type="checkbox" checked={autoSave} onChange={event => setAutoSave(event.target.checked)} /> Auto-save (1s)</label>
        <label><input type="checkbox" checked={failNext} onChange={event => setFailNext(event.target.checked)} /> Fail the next save</label>
        <button type="button" onClick={() => setLog([])}>Clear log</button>
      </header>
      <main className="app-main">
        <div className="app-table">
          <DataTable
            data={data}
            columns={columns}
            createRow={() => ({ name: '', sku: '', category: 'hardware', tags: [], price: null, stock: 0, active: true, launch: null, rating: null, photo: null, gallery: [], notes: '' })}
            onSave={onSave}
            {...(autoSave ? { autoSave: 1000 } : {})}
          />
        </div>
        <aside className="app-side">
          <h2>Try</h2>
          <h2>Multi-cell editing</h2>
          <ul>
            <li>Select several cells (drag, <kbd>Shift</kbd>, or <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+click for separate ranges), type a value, then <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>Enter</kbd> to apply it to every selected cell (<kbd>Enter</kbd> alone edits just the active cell)</li>
            <li>For dropdowns, hold <kbd>⌘</kbd>/<kbd>Ctrl</kbd> while clicking an option</li>
            <li><kbd>⌘E</kbd> or right-click → <b>Edit N cells…</b>: per-column operations (find &amp; replace, prefix, increase by, add/remove tags, shift dates…) with a live preview</li>
            <li>Right-click for <b>quick edits</b> by column type: set a category, add/remove tags, check/uncheck/toggle, ±1, round, today, shift dates, change case, set a rating</li>
            <li><kbd>Del</kbd>, paste and <kbd>Space</kbd> on checkboxes also apply to every range</li>
          </ul>
          <h2>Also</h2>
          <ul>
            <li>Type on a cell to edit; <kbd>Enter</kbd> / <kbd>Tab</kbd> to commit, <kbd>Esc</kbd> to cancel</li>
            <li>Drag to select, <kbd>Shift</kbd>+arrows to extend, <kbd>⌘A</kbd> all</li>
            <li>Copy a range to Excel / Sheets and paste back; paste past the last row adds rows</li>
            <li>Drag the small square at the selection corner to fill</li>
            <li><kbd>Del</kbd> clears, <kbd>⌘Z</kbd> / <kbd>⇧⌘Z</kbd> undo/redo, <kbd>⌘D</kbd> fill down, <kbd>⌘S</kbd> save</li>
            <li>Right-click for row actions</li>
            <li>Price must be ≥ 0; Name is required</li>
            <li>Read-only cells are hatched: SKU always (🔒 in the header), Stock when the product is inactive</li>
            <li>Rating is a custom field type: press 1–5 or click stars</li>
            <li>Photo (one image) and Gallery (up to 6) use <code>createImageType</code>: press Enter to add images by file, drag &amp; drop, paste, or URL</li>
          </ul>
          <h2>onSave calls</h2>
          {!log.length && <p className="muted">Nothing saved yet.</p>}
          {log.map((entry, index) => (
            <details key={index} className={entry.failed ? 'failed' : undefined}>
              <summary>{entry.at} — {entry.failed ? `failed: ${entry.detail}` : entry.summary}</summary>
              {!entry.failed && <pre>{entry.detail}</pre>}
            </details>
          ))}
        </aside>
      </main>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
