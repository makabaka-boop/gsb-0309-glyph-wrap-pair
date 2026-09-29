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
})
