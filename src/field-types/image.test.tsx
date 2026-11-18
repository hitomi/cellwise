import { describe, expect, it } from 'vitest'
import { defineColumns } from '../core/columns.js'
import { createTable } from '../core/table.js'
import { createImageType } from './image.js'

type Product = { id: number; photo: string | null; gallery: string[] }

const photo = createImageType()
const gallery = createImageType({ multiple: true, maxCount: 3 })
const columns = defineColumns<Product>([
  { field: 'photo', type: photo },
  { field: 'gallery', type: gallery },
])

describe('image type', () => {
  it('parses one URL for single images and a list for multiple', () => {
    expect(photo.parse('https://x.test/a.png', {})).toBe('https://x.test/a.png')
    expect(photo.parse('https://x.test/a.png https://x.test/b.png', {})).toEqual({ error: 'Only one image' })
    expect(gallery.parse('https://x.test/a.png\n/b.png', {})).toEqual(['https://x.test/a.png', '/b.png'])
    expect(gallery.parse('a b c d'.split(' ').map(n => `/${n}.png`).join(' '), {})).toEqual({ error: 'At most 3 images' })
    expect(photo.parse('hello', {})).toEqual({ error: 'Not an image URL' })
    expect(photo.parse('  ', {})).toBeNull()
  })

  it('copies and pastes images between cells through their URLs', () => {
    const t = createTable<Product>({
      data: [{ id: 1, photo: '/a.png', gallery: ['/a.png', '/b.png'] }, { id: 2, photo: null, gallery: [] }],
      columns,
    })
    const text = t.copy({ rowStart: 0, rowEnd: 0, colStart: 0, colEnd: 1 })
    expect(text).toBe('/a.png\t/a.png /b.png')
    t.paste({ rowStart: 1, rowEnd: 1, colStart: 0, colEnd: 0 }, text)
    expect(t.getRow(2)).toEqual({ id: 2, photo: '/a.png', gallery: ['/a.png', '/b.png'] })
    t.setCell(2, 'gallery', ['/a.png', '/b.png'])
    expect(t.getCell(2, 'gallery').changed).toBe(true)
    t.setCell(2, 'gallery', null)
    expect(t.getCell(2, 'gallery').changed).toBe(false)
  })

  it('turns dropped files into URLs: single replaces, multiple appends what fits', async () => {
    const upload = async (file: File) => `/uploads/${file.name}`
    const png = (name: string) => new File(['x'], name, { type: 'image/png' })
    const single = createImageType({ upload })
    const many = createImageType({ multiple: true, maxCount: 3, upload })
    const replace = await single.files!.receive([png('a.png'), png('b.png')], {})
    expect(replace('/old.png')).toBe('/uploads/a.png')
    const append = await many.files!.receive([png('a.png'), png('b.png'), new File(['x'], 'notes.txt', { type: 'text/plain' })], {})
    expect(append(['/old.png'])).toEqual(['/old.png', '/uploads/a.png', '/uploads/b.png'])
    expect(append(['/1.png', '/2.png'])).toEqual(['/1.png', '/2.png', '/uploads/a.png'])
    expect(append(['/1.png', '/2.png', '/3.png'])).toEqual({ error: 'At most 3 images' })
  })

  it('rejects a column whose field type does not match', () => {
    // @ts-expect-error a single image needs a string field
    defineColumns<Product>([{ field: 'gallery', type: photo }])
    // @ts-expect-error several images need a string[] field
    defineColumns<Product>([{ field: 'photo', type: gallery }])
  })
})
