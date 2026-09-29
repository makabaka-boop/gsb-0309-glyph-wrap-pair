import { describe, expect, it } from 'vitest'
import { buildExportSnapshot, layoutToJson, rasterize } from './export'
import { composeLayout } from './layout'
import { decodePng, encodePng } from './png'
import type { GlyphPage } from './types'

const page: GlyphPage = {
  height: 2,
  glyphs: [
    {
      char: 'A',
      width: 3,
      height: 2,
      rows: [
        [1, 0, 0],
        [0, 0, 1],
      ],
    },
    {
      char: 'B',
      width: 1,
      height: 2,
      rows: [[1], [1]],
    },
  ],
}

function snapshotOf(text: string) {
  const r = composeLayout(page, text)
  if (!r.ok) throw new Error(r.error!.message)
  const rowsMap = new Map(page.glyphs.map((g) => [g.char, g.rows]))
  return buildExportSnapshot(r.layout!, rowsMap)
}

describe('导出：PNG / JSON 同源与逐像素正确', () => {
  it('合成图：黑像素按来源字着色，背景白色，空白覆盖不染色', () => {
    // A 的点 (0,0)(2,1)；B 黑点 (0,0)(0,1)。
    // A@0 与 B：B 候选 1 时 (全局1,0)/(1,1) 不碰 A -> x_B=1。
    const snap = snapshotOf('AB')
    const { raster, layout } = snap
    expect(raster.width).toBe(layout.canvasWidth)
    expect(raster.height).toBe(2)

    const at = (x: number, y: number) => {
      const o = (y * raster.width + x) * 4
      return [raster.data[o], raster.data[o + 1], raster.data[o + 2]]
    }
    const hex = (h: string) => [
      parseInt(h.slice(1, 3), 16),
      parseInt(h.slice(3, 5), 16),
      parseInt(h.slice(5, 7), 16),
    ]
    expect(at(0, 0)).toEqual(hex(layout.palette[0])) // A 实例 0
    expect(at(2, 1)).toEqual(hex(layout.palette[0]))
    expect(at(1, 0)).toEqual(hex(layout.palette[1])) // B 实例 1
    expect(at(1, 1)).toEqual(hex(layout.palette[1]))
    expect(at(2, 0)).toEqual([255, 255, 255]) // 空白
  })

  it('PNG 编码再解码，逐像素等于栅格数据', async () => {
    const snap = snapshotOf('ABAB')
    const bytes = await encodePng(snap.raster)
    // PNG 魔数。
    expect(Array.from(bytes.subarray(0, 8))).toEqual([
      137, 80, 78, 71, 13, 10, 26, 10,
    ])
    const decoded = await decodePng(bytes)
    expect(decoded.width).toBe(snap.raster.width)
    expect(decoded.height).toBe(snap.raster.height)
    expect(Array.from(decoded.data)).toEqual(Array.from(snap.raster.data))
  })

  it('位置 JSON 与 PNG 来自同一快照：位置/画布/颜色逐条一致', async () => {
    const snap = snapshotOf('BAA')
    const json = layoutToJson(snap.layout)
    const decoded = await decodePng(await encodePng(snap.raster))

    expect(json.canvas).toEqual({
      width: snap.layout.canvasWidth,
      height: snap.layout.canvasHeight,
    })
    expect(json.positions.map((p) => p.x)).toEqual(
      snap.layout.placed.map((p) => p.x),
    )

    // JSON 中每个位置的黑像素必须在 PNG 解码结果里呈现其来源颜色，
    // 以此证明“导出 PNG 和位置 JSON 来自同一布局”。
    const rowsByChar = new Map(page.glyphs.map((g) => [g.char, g.rows]))
    for (const p of json.positions) {
      const rows = rowsByChar.get(p.char)!
      const rgb = [
        parseInt(p.color.slice(1, 3), 16),
        parseInt(p.color.slice(3, 5), 16),
        parseInt(p.color.slice(5, 7), 16),
      ]
      for (let r = 0; r < p.height; r++) {
        for (let c = 0; c < p.width; c++) {
          if (!rows[r][c]) continue
          const o = (r * decoded.width + (p.x + c)) * 4
          expect([decoded.data[o], decoded.data[o + 1], decoded.data[o + 2]]).toEqual(rgb)
        }
      }
    }
  })

  it('全空合成图：bbox 序列化为 EMPTY，PNG 全白且尺寸合法', async () => {
    const emptyPage: GlyphPage = {
      height: 3,
      glyphs: [
        {
          char: 'a',
          width: 2,
          height: 3,
          rows: [
            [0, 0],
            [0, 0],
            [0, 0],
          ],
        },
        {
          char: 'b',
          width: 4,
          height: 3,
          rows: [
            [0, 0, 0, 0],
            [0, 0, 0, 0],
            [0, 0, 0, 0],
          ],
        },
      ],
    }
    const r = composeLayout(emptyPage, 'ab')
    expect(r.ok).toBe(true)
    const snap = buildExportSnapshot(
      r.layout!,
      new Map(emptyPage.glyphs.map((g) => [g.char, g.rows])),
    )
    expect(layoutToJson(snap.layout).bbox).toBe('EMPTY')
    expect(snap.raster.width).toBeGreaterThanOrEqual(1)
    expect(snap.raster.height).toBe(3)
    const decoded = await decodePng(await encodePng(snap.raster))
    for (let i = 0; i < decoded.data.length; i += 4) {
      expect([decoded.data[i], decoded.data[i + 1], decoded.data[i + 2]]).toEqual([
        255, 255, 255,
      ])
      expect(decoded.data[i + 3]).toBe(255)
    }
  })

  it('bbox 是全部黑像素的全局最小包围盒（考虑凹口伸入后的实际范围）', () => {
    const snap = snapshotOf('AB')
    // A@0 黑 (0,0)(2,1)，B@1 黑 (1,0)(1,1)
    // 全局黑像素：x 0..2, y 0..1
    expect(snap.layout.bbox).toEqual({
      minX: 0,
      minY: 0,
      maxX: 2,
      maxY: 1,
    })
  })

  it('rasterize 直接入参也不修改布局', () => {
    const snap = snapshotOf('AB')
    const rowsMap = new Map(page.glyphs.map((g) => [g.char, g.rows]))
    const raster2 = rasterize(snap.layout, rowsMap)
    expect(Array.from(raster2.data)).toEqual(Array.from(snap.raster.data))
  })

  it('多行：位置 JSON（含 row/y）与 PNG 同源，行间空白行全白', async () => {
    // 页高 2、1 宽字形；行宽 2：前两个 1 宽字可同行（不碰撞），
    // 第三个字因行宽自动折到下一行，'\n' 再强制空出一行。
    const narrow: GlyphPage = {
      height: 2,
      glyphs: [
        { char: 'A', width: 1, height: 2, rows: [[1], [0]] },
        { char: 'B', width: 1, height: 2, rows: [[0], [1]] },
      ],
    }
    const r = composeLayout(narrow, 'AB\n\nA', 2)
    expect(r.ok).toBe(true)
    const rowsMap = new Map(narrow.glyphs.map((g) => [g.char, g.rows]))
    const snap = buildExportSnapshot(r.layout!, rowsMap)
    const json = layoutToJson(snap.layout)

    // 视觉行：行0 A@0,B@1；'\n' → 行1（空）；'\n' → 行2 A@0。共 3 行。
    expect(json.positions.map((p) => [p.char, p.x, p.y, p.row])).toEqual([
      ['A', 0, 0, 0],
      ['B', 1, 0, 0],
      ['A', 0, 6, 2],
    ])
    expect(json.canvas).toEqual({ width: 2, height: 8 }) // 3 行 *2 + 2 空白行

    const decoded = await decodePng(await encodePng(snap.raster))
    expect(decoded.width).toBe(2)
    expect(decoded.height).toBe(8)
    const px = (x: number, y: number) => {
      const o = (y * 2 + x) * 4
      return [decoded.data[o], decoded.data[o + 1], decoded.data[o + 2]]
    }
    const white: [number, number, number] = [255, 255, 255]
    const hex = (h: string): [number, number, number] => [
      parseInt(h.slice(1, 3), 16),
      parseInt(h.slice(3, 5), 16),
      parseInt(h.slice(5, 7), 16),
    ]
    // 行0：y0 左 A 黑右白；y1 左白右 B 黑。
    expect(px(0, 0)).toEqual(hex(json.positions[0].color))
    expect(px(1, 0)).toEqual(white)
    expect(px(0, 1)).toEqual(white)
    expect(px(1, 1)).toEqual(hex(json.positions[1].color))
    // 间隔行 y=2、强制空行 y=3,4、行2 间隔 y=5 全部为白。
    for (let y = 2; y <= 5; y++) {
      expect(px(0, y)).toEqual(white)
      expect(px(1, y)).toEqual(white)
    }
    // 行2：y6 左 A 黑，y7 全白。
    expect(px(0, 6)).toEqual(hex(json.positions[2].color))
    expect(px(1, 6)).toEqual(white)
    expect(px(0, 7)).toEqual(white)
    expect(px(1, 7)).toEqual(white)
  })
})
