import { describe, expect, it } from 'vitest'
import type { GlyphPage } from '../lib/types'
import { validatePage } from '../lib/glyph'

function glyph(
  char: string,
  width: number,
  height: number,
  rows?: number[][],
) {
  return {
    char,
    width,
    height,
    rows:
      rows ??
      Array.from({ length: height }, () =>
        Array.from({ length: width }, () => 0),
      ),
  }
}

const validPage = (): GlyphPage => ({
  height: 4,
  glyphs: [glyph('A', 2, 4), glyph('B', 3, 4)],
})

describe('validatePage', () => {
  it('合法页面无问题', () => {
    expect(validatePage(validPage())).toEqual([])
  })

  it('字形数量必须 2~40', () => {
    const one = validatePage({ height: 4, glyphs: [glyph('A', 1, 4)] })
    expect(one.some((i) => i.kind === 'glyph-count')).toBe(true)
    const many = validatePage({
      height: 2,
      glyphs: Array.from({ length: 41 }, (_, i) => glyph(String(i), 1, 2)),
    })
    expect(many.some((i) => i.kind === 'glyph-count')).toBe(true)
  })

  it('页面高度越界、字形与页面不同高均非法', () => {
    expect(validatePage({ ...validPage(), height: 0 }).some((i) => i.kind === 'height')).toBe(true)
    expect(validatePage({ ...validPage(), height: 33 }).some((i) => i.kind === 'height')).toBe(true)
    const mismatch = validatePage({
      height: 4,
      glyphs: [glyph('A', 2, 3), glyph('B', 3, 4)],
    })
    expect(mismatch.some((i) => i.kind === 'glyph-dimensions')).toBe(true)
  })

  it('宽高越界、位图形状不符、像素值非 0/1 均非法', () => {
    const badDim = validatePage({
      height: 4,
      glyphs: [glyph('A', 0, 4), glyph('B', 3, 4)],
    })
    expect(badDim.some((i) => i.kind === 'glyph-dimensions')).toBe(true)

    const shape: GlyphPage = {
      height: 2,
      glyphs: [
        { char: 'A', width: 2, height: 2, rows: [[0], [0, 0]] },
        glyph('B', 1, 2),
      ],
    }
    expect(validatePage(shape).some((i) => i.kind === 'glyph-shape')).toBe(true)

    const pixel: GlyphPage = {
      height: 2,
      glyphs: [
        { char: 'A', width: 2, height: 2, rows: [[0, 2], [0, 0]] },
        glyph('B', 1, 2),
      ],
    }
    expect(validatePage(pixel).some((i) => i.kind === 'glyph-pixel')).toBe(true)
  })

  it('空字符、多码点字符、重复字符非法', () => {
    const dup = validatePage({
      height: 2,
      glyphs: [glyph('A', 1, 2), glyph('A', 1, 2)],
    })
    expect(dup.some((i) => i.kind === 'duplicate-char')).toBe(true)

    const emptyChar = validatePage({
      height: 2,
      glyphs: [glyph('', 1, 2), glyph('B', 1, 2)],
    })
    expect(emptyChar.some((i) => i.kind === 'empty-char')).toBe(true)

    const multi = validatePage({
      height: 2,
      glyphs: [glyph('ab', 1, 2), glyph('B', 1, 2)],
    })
    expect(multi.some((i) => i.kind === 'multi-codepoint-char')).toBe(true)
  })

  it('代理对字符按单码点计为合法', () => {
    const page: GlyphPage = {
      height: 1,
      glyphs: [glyph('😀', 1, 1, [[1]]), glyph('B', 1, 1, [[0]])],
    }
    expect(validatePage(page)).toEqual([])
  })
})
