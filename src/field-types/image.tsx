import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { defineFieldType, type EditorProps, type FieldType } from '../core/field-type.js'

export interface ImageTypeConfig {
  /** Store several images per cell (value `string[]`) instead of one (value `string`). */
  multiple?: boolean
  /** Most images per cell when `multiple`. Default: no limit. */
  maxCount?: number
  /**
   * Upload a picked, dropped or pasted file and return its URL. Without it,
   * files are stored inline as data URLs, which is only suitable for small images.
   */
  upload?: (file: File) => Promise<string>
  /** File types offered by the file picker. Default `image/*`. */
  accept?: string
}

const urlPattern = /^(https?:\/\/|data:image\/|blob:|\/|\.{1,2}\/)/i

function toList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string')
  return typeof value === 'string' && value ? [value] : []
}

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'))
    reader.readAsDataURL(file)
  })
}

/** Image cells holding image URLs: one per cell, or several with `multiple: true`. */
export function createImageType(config: ImageTypeConfig & { multiple: true }): FieldType<string[], {}>
export function createImageType(config?: ImageTypeConfig & { multiple?: false }): FieldType<string, {}>
export function createImageType(config: ImageTypeConfig = {}): FieldType<any, {}> {
  const multiple = config.multiple ?? false
  const limit = multiple ? config.maxCount ?? Infinity : 1
  const upload = config.upload ?? readAsDataUrl
  const accept = config.accept ?? 'image/*'
  const toValue = (list: string[]) => multiple ? (list.length ? list : null) : list[0] ?? null

  function ImageCell({ value }: { value: unknown }) {
    const list = toList(value)
    const shown = list.slice(0, multiple ? 3 : 1)
    return (
      <span className="cw-thumbs">
        {shown.map((src, index) => <img key={index} className="cw-thumb" src={src} alt="" loading="lazy" decoding="async" draggable={false} />)}
        {list.length > shown.length && <span className="cw-thumb-more">+{list.length - shown.length}</span>}
      </span>
    )
  }

  function ImageEditor({ value, initialText, onCommit, onCancel }: EditorProps<any, {}>) {
    const [images, setImages] = useState(() => toList(value))
    const [pending, setPending] = useState<{ id: number; preview: string }[]>([])
    const [error, setError] = useState<string>()
    const [url, setUrl] = useState(initialText ?? '')
    const [dragging, setDragging] = useState(false)
    const root = useRef<HTMLDivElement>(null)
    const urlInput = useRef<HTMLInputElement>(null)
    const fileInput = useRef<HTMLInputElement>(null)
    const nextId = useRef(0)
    const latest = useRef({ images, pending })
    latest.current = { images, pending }

    // Clicking anywhere outside the editor commits (focus is unreliable here: removing an
    // image removes the focused button, and the file picker takes focus away).
    const latestCommit = useRef(() => {})
    latestCommit.current = () => {
      if (!latest.current.pending.length) onCommit(toValue(latest.current.images))
    }
    useEffect(() => {
      const outside = (event: MouseEvent) => {
        if (!root.current?.contains(event.target as Node)) latestCommit.current()
      }
      window.addEventListener('mousedown', outside, true)
      return () => window.removeEventListener('mousedown', outside, true)
    }, [])

    useLayoutEffect(() => {
      if (initialText !== undefined) urlInput.current?.focus()
      else root.current?.focus()
    }, [initialText])

    const room = () => multiple ? limit - latest.current.images.length - latest.current.pending.length : 1

    function commit() {
      if (latest.current.pending.length) { setError('Wait for the upload to finish'); return }
      onCommit(toValue(latest.current.images))
    }

    function add(src: string) {
      setImages(current => multiple ? [...current, src] : [src])
    }

    async function addFiles(files: File[]) {
      const accepted = files.filter(file => file.type.startsWith('image/'))
      if (!accepted.length) { setError('Choose an image file'); return }
      const slots = Math.max(0, room())
      if (accepted.length > slots) setError(slots ? `Only ${slots} more ${slots === 1 ? 'image fits' : 'images fit'}` : `At most ${limit} images`)
      else setError(undefined)
      await Promise.all(accepted.slice(0, slots).map(async file => {
        const entry = { id: nextId.current++, preview: URL.createObjectURL(file) }
        setPending(current => [...current, entry])
        try {
          add(await upload(file))
        } catch (failure) {
          setError(`Upload failed: ${failure instanceof Error ? failure.message : String(failure)}`)
        } finally {
          setPending(current => current.filter(item => item.id !== entry.id))
          URL.revokeObjectURL(entry.preview)
        }
      }))
    }

    function addUrls(text: string) {
      const urls = text.split(/\s+/).filter(Boolean)
      const invalid = urls.find(entry => !urlPattern.test(entry))
      if (invalid) { setError(`"${invalid.slice(0, 40)}" is not an image URL`); return false }
      const slots = room()
      if (urls.length > slots) { setError(slots ? `Only ${slots} more ${slots === 1 ? 'image fits' : 'images fit'}` : `At most ${limit} images`); return false }
      for (const entry of urls) add(entry)
      setError(undefined)
      return true
    }

    const canAdd = !multiple || images.length + pending.length < limit
    return (
      <div ref={root} className="cw-image-editor" tabIndex={-1} data-dragging={dragging || undefined}
        onKeyDown={event => {
          if (event.target === urlInput.current) return
          if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); commit() }
        }}
        onPaste={event => {
          const files = [...event.clipboardData.files]
          if (files.length) { event.preventDefault(); void addFiles(files); return }
          if (event.target !== urlInput.current) {
            event.preventDefault()
            addUrls(event.clipboardData.getData('text/plain'))
          }
        }}
        onDragOver={event => { event.preventDefault(); setDragging(true) }}
        onDragLeave={event => { if (!root.current?.contains(event.relatedTarget as Node)) setDragging(false) }}
        onDrop={event => { event.preventDefault(); setDragging(false); void addFiles([...event.dataTransfer.files]) }}
        >
        <div className="cw-image-grid">
          {images.map((src, index) => (
            <figure key={`${index}:${src.slice(-24)}`} className="cw-image-tile">
              <a href={src} target="_blank" rel="noreferrer" tabIndex={-1}><img src={src} alt={`Image ${index + 1}`} draggable={false} /></a>
              <button type="button" className="cw-image-remove" aria-label={`Remove image ${index + 1}`}
                onClick={() => {
                  setImages(current => current.filter((_, i) => i !== index))
                  // The button disappears; keep keyboard focus in the editor.
                  root.current?.focus()
                }}>×</button>
            </figure>
          ))}
          {pending.map(entry => (
            <figure key={entry.id} className="cw-image-tile" data-pending>
              <img src={entry.preview} alt="Uploading" />
              <span className="cw-spinner" aria-label="Uploading" />
            </figure>
          ))}
          {canAdd && (
            <button type="button" className="cw-image-add" onClick={() => fileInput.current?.click()}>
              <span aria-hidden="true">+</span>{multiple || !images.length ? 'Add' : 'Replace'}
            </button>
          )}
        </div>
        <input ref={urlInput} className="cw-input-small cw-image-url" placeholder="Paste an image URL and press Enter" value={url}
          onChange={event => { setUrl(event.target.value); setError(undefined) }}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault()
              event.stopPropagation()
              if (!url.trim()) commit()
              else if (addUrls(url)) setUrl('')
            }
          }} />
        {error && <div className="cw-image-error" role="alert">{error}</div>}
        <div className="cw-image-footer">
          <span className="cw-hint">
            Drop or paste images{multiple && Number.isFinite(limit) ? ` · ${images.length}/${limit}` : ''}
          </span>
          <span className="cw-spacer" />
          <button type="button" className="cw-button" onClick={onCancel}>Cancel</button>
          <button type="button" className="cw-button cw-primary" disabled={pending.length > 0} onClick={commit}>Done</button>
        </div>
        <input ref={fileInput} type="file" hidden accept={accept} multiple={multiple}
          onChange={event => { void addFiles([...event.target.files ?? []]); event.target.value = '' }} />
      </div>
    )
  }

  return defineFieldType<any, {}>({
    name: multiple ? 'images' : 'image',
    parse(text) {
      const urls = text.split(/\s+/).filter(Boolean)
      if (!urls.length) return null
      const invalid = urls.find(entry => !urlPattern.test(entry))
      if (invalid) return { error: 'Not an image URL' }
      if (urls.length > limit) return { error: multiple ? `At most ${limit} images` : 'Only one image' }
      return toValue(urls)
    },
    // Copy and paste carry the URLs, separated by spaces.
    format: value => toList(value).join(' '),
    equals: (a, b) => {
      const x = toList(a), y = toList(b)
      return x.length === y.length && x.every((entry, index) => entry === y[index])
    },
    // Sort by number of images.
    compare: (a, b) => toList(a).length - toList(b).length,
    validate: value => toList(value).length > limit ? `At most ${limit} images` : undefined,
    filters: {
      countAtLeast: { label: 'has at least (images)', test: (value, arg: number) => toList(value).length >= Number(arg) },
    },
    // Drop or paste images straight onto a cell: single replaces, multiple appends what fits.
    files: {
      accept,
      async receive(files) {
        const images = files.filter(file => file.type.startsWith('image/'))
        const urls = await Promise.all(images.slice(0, Number.isFinite(limit) ? limit : undefined).map(file => upload(file)))
        return current => {
          if (!urls.length) return { error: 'No image files' }
          if (!multiple) return urls[0]!
          const list = [...toList(current), ...urls]
          if (toList(current).length >= limit) return { error: `At most ${limit} images` }
          return list.slice(0, limit)
        }
      },
    },
    Cell: ImageCell,
    Editor: ImageEditor,
  })
}
