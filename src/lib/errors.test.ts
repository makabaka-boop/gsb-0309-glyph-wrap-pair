import { describe, expect, it } from 'vitest'
import { composeLayout, MAX_TEXT_LENGTH } from './layout'
import type { Glyph, GlyphPage } from './types'

const glyph = (char: string, rows: number[][]): Glyph => ({
  char,
  width: rows[0].length,
  height: rows.length,
  rows,
})

const page: GlyphPage = {
  height: 2,
  glyphs: [
    glyph('A', [
      [1, 0],
      [0, 1],
    ]),
    glyph('B', [
      [0, 1],
      [1, 0],
    ]),
  ],
}

describe('composeLayout 错误处理', () => {
  it('空字串报 empty-text', () => {
    const r = composeLayout(page, '')
    expect(r.ok).toBe(false)
    expect(r.error!.kind).toBe('empty-text')
  })

  it('超过 80 码点报 text-too-long（代理对按码点计数）', () => {
    const r = composeLayout(page, 'A'.repeat(MAX_TEXT_LENGTH + 1))
    expect(r.error!.kind).toBe('text-too-long')
    const emoji = '😀'.repeat(41) // 81 个 UTF-16 单元，41 码点，合法长度
    const r2 = composeLayout(
      {
        height: 1,
        glyphs: [
          { char: '😀', width: 1, height: 1, rows: [[1]] },
          { char: 'B', width: 1, height: 1, rows: [[0]] },
        ],
      },
      emoji,
    )
    expect(r2.ok).toBe(true)
  })

  it('缺失字符报 missing-char 并指出该字符', () => {
    const r = composeLayout(page, 'AC')
    expect(r.ok).toBe(false)
    expect(r.error!.kind).toBe('missing-char')
    expect(r.error!.char).toBe('C')
  })

  it('页面非法时报 invalid-page 并附带问题列表', () => {
    const bad: GlyphPage = {
      height: 2,
      glyphs: [{ ...glyph('A', [[1], [0]]), rows: [[1]] }],
    }
    const r = composeLayout(bad, 'A')
    expect(r.ok).toBe(false)
    expect(r.error!.kind).toBe('invalid-page')
    expect(r.error!.issues!.length).toBeGreaterThan(0)
  })

  it('单字外框宽于行宽报 glyph-too-wide（换行也无法容纳）', () => {
    const r = composeLayout(page, 'AB', 1)
    expect(r.ok).toBe(false)
    expect(r.error!.kind).toBe('glyph-too-wide')
    expect(r.error!.width).toBe(2)
    expect(r.error!.maxWidth).toBe(1)
  })

  it('换行符不需要字形，含手动换行的字串不报 missing-char', () => {
    const r = composeLayout(page, 'A\nB')
    expect(r.ok).toBe(true)
    expect(r.layout!.placed).toHaveLength(2)
    expect(r.layout!.rowCount).toBe(2)
  })

  it('只有换行的字串是合法排版（空行画布），不是 empty-text', () => {
    const r = composeLayout(page, '\n\n')
    expect(r.ok).toBe(true)
    expect(r.layout!.placed).toHaveLength(0)
    expect(r.layout!.rowCount).toBe(3)
    expect(r.layout!.bbox).toBeNull()
    expect(r.layout!.canvasWidth).toBe(1)
    expect(r.layout!.canvasHeight).toBe(3 * 2 + 2) // 8：3 行高 + 2 空白间隔行
  })
})
