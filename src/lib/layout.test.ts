import { describe, expect, it } from 'vitest'
import { composeLayout, masksCollide, normalizeNewlines } from '../lib/layout'
import { rowMasks } from '../lib/glyph'
import { generateCase, referenceLayout } from '../test/reference'
import type { Glyph, GlyphPage } from '../lib/types'

const KEY_XF = 100000 // 二维全局格键：key = gx * KEY_XF + gy

/**
 * 规格级断言（二维多行）：
 * 与朴素参考实现完全一致、行内位置严格递增、无黑像素重合（跨行天然不碰）、
 * 候选极小性、外框不超行宽、换行决策正确、bbox/画布（含空行高度）一致。
 */
function expectSpecConformance(
  page: GlyphPage,
  rawText: string,
  maxWidth?: number,
) {
  const text = normalizeNewlines(rawText)
  const result = composeLayout(page, text, maxWidth)
  expect(result.ok).toBe(true)
  const layout = result.layout!
  const ref = referenceLayout(page, text, maxWidth)

  // 与朴素逐像素参考实现完全一致。
  expect(layout.placed.map((p) => [p.x, p.y])).toEqual(
    ref.placed.map((p) => [p.x, p.y]),
  )
  expect(layout.placed.map((p) => p.row)).toEqual(ref.placed.map((p) => p.row))
  expect(layout.placed.map((p) => p.index)).toEqual(
    ref.placed.map((p) => p.index),
  )
  expect(layout.bbox).toEqual(ref.bbox)
  expect(layout.canvasWidth).toBe(ref.canvasWidth)
  expect(layout.canvasHeight).toBe(ref.canvasHeight)
  expect(layout.rowCount).toBe(ref.rowCount)

  const byChar = new Map(page.glyphs.map((g) => [g.char, g]))
  const masksByChar = new Map(page.glyphs.map((g) => [g.char, rowMasks(g)]))
  const limit =
    maxWidth === undefined || !Number.isFinite(maxWidth) ? Infinity : maxWidth

  // 穷举所有已放黑像素到全局二维占用格：每个格至多出现一次，
  // 一次遍历即覆盖“同一视觉行任意两字”（含隔字碰撞）。
  const occupied = new Set<number>()
  const actualBlack: Array<[number, number]> = []
  for (const p of layout.placed) {
    const g = byChar.get(p.char)!
    expect(p.row * (page.height + 1)).toBe(p.y)
    expect(p.x + p.width).toBeLessThanOrEqual(limit)
    for (let r = 0; r < g.height; r++) {
      for (let c = 0; c < g.width; c++) {
        if (!g.rows[r][c]) continue
        const gx = p.x + c
        const gy = p.y + r
        const key = gx * KEY_XF + gy
        expect(
          occupied.has(key),
          `全局像素 (${gx},${gy}) 被两个字的黑像素同时占据`,
        ).toBe(false)
        occupied.add(key)
        actualBlack.push([gx, gy])
      }
    }
  }

  // 重新模拟输入的换行决策：记录每个字形实例“本应所属的视觉行”，
  // 与实现的 p.row 逐一对比，独立验证自动/强制换行（不依赖参考实现）。
  const expectRows: number[] = []
  {
    let row = 0
    // 每个视觉行上已放字形的最小信息：字符与行内 x。
    const lineGlyphs: Array<{ ch: string; x: number }> = []
    for (const ch of Array.from(text)) {
      if (ch === '\n') {
        row += 1
        lineGlyphs.length = 0
        continue
      }
      const curMasks = masksByChar.get(ch)!
      let x = 0
      if (lineGlyphs.length > 0) {
        x = lineGlyphs[lineGlyphs.length - 1].x + 1
        let found = false
        while (x + byChar.get(ch)!.width <= limit) {
          let collision = false
          for (const q of lineGlyphs) {
            if (masksCollide(masksByChar.get(q.ch)!, curMasks, x - q.x)) {
              collision = true
              break
            }
          }
          if (!collision) {
            found = true
            break
          }
          x++
        }
        if (!found) {
          row += 1
          lineGlyphs.length = 0
          x = 0
        }
      }
      expectRows.push(row)
      lineGlyphs.push({ ch, x })
    }
  }
  expect(layout.placed.map((p) => p.row)).toEqual(expectRows)

  // 行内性质：每行首字 x=0；左边缘严格递增；候选极小性
  // （被跳过的候选必与同行某字碰撞，含隔字）；最终候选与同行所有字不碰。
  for (let i = 0; i < layout.placed.length; i++) {
    const p = layout.placed[i]
    const sameLine = layout.placed
      .slice(0, i)
      .filter((q) => q.row === p.row)
    if (sameLine.length === 0) {
      expect(p.x).toBe(0)
    } else {
      const prevP = sameLine[sameLine.length - 1]
      expect(p.x).toBeGreaterThan(prevP.x)
      const curMasks = masksByChar.get(p.char)!
      for (let x = prevP.x + 1; x < p.x; x++) {
        let any = false
        for (const q of sameLine) {
          if (masksCollide(masksByChar.get(q.char)!, curMasks, x - q.x)) {
            any = true
            break
          }
        }
        expect(any, `行${p.row} x=${x} 本应碰撞，否则 ${p.x} 不是最小候选`).toBe(
          true,
        )
      }
      for (const q of sameLine) {
        expect(masksCollide(masksByChar.get(q.char)!, curMasks, p.x - q.x)).toBe(
          false,
        )
      }
    }
  }

  // bbox 必须恰好包住所有全局黑像素（独立穷举，不依赖实现内部记录）。
  if (actualBlack.length === 0) {
    expect(layout.bbox).toBeNull()
  } else {
    const minX = Math.min(...actualBlack.map(([x]) => x))
    const maxX = Math.max(...actualBlack.map(([x]) => x))
    const minY = Math.min(...actualBlack.map(([, y]) => y))
    const maxY = Math.max(...actualBlack.map(([, y]) => y))
    expect(layout.bbox).toEqual({ minX, minY, maxX, maxY })
  }

  // 画布：宽度覆盖所有字形外框；高度覆盖全部视觉行（含空行）。
  const rows = layout.rowCount
  expect(layout.canvasWidth).toBe(
    Math.max(1, ...layout.placed.map((p) => p.x + p.width)),
  )
  expect(layout.canvasHeight).toBe(rows * page.height + (rows - 1))
  // 显式换行符数 + 1 是行数下界（自动换行会让行数更多）。
  expect(rows).toBeGreaterThanOrEqual(
    Array.from(text).filter((c) => c === '\n').length + 1,
  )

  return layout
}

describe('composeLayout — 快速实现对拍朴素逐像素实现（随机穷举）', () => {
  // 大量小尺寸用例：密集覆盖各种凹口/空字/重复组合。
  const SMALL = 200
  for (let seed = 1; seed <= SMALL; seed++) {
    it(`small fuzz seed=${seed}`, () => {
      const { page, text } = generateCase(seed, {
        maxHeight: 8,
        maxWidth: 12,
        maxGlyphs: 12,
        maxLen: 40,
      })
      expectSpecConformance(page, text)
    })
  }

  // 全尺寸上限用例：高/宽到 32、字形到 40、字串到 80，数量少一些。
  const FULL = 24
  for (let k = 0; k < FULL; k++) {
    it(`full fuzz #${k + 1}`, () => {
      const { page, text } = generateCase(100000 + k * 7919)
      expectSpecConformance(page, text)
    })
  }

  // 极端：全部实心（最坏碰撞密度）与全空（全 EMPTY）。
  it('全实心字形对拍', () => {
    const { page, text } = generateCase(7, {
      maxHeight: 32,
      minWidth: 30,
      maxWidth: 32,
      maxGlyphs: 40,
      emptyRate: 0,
    })
    // 强制全部实心。
    for (const g of page.glyphs)
      for (const row of g.rows) row.fill(1)
    expectSpecConformance(page, text)
  })
  it('全空字形对拍（EMPTY）', () => {
    const { page, text } = generateCase(7, {
      maxHeight: 32,
      maxWidth: 32,
      maxGlyphs: 40,
      emptyRate: 1,
    })
    expectSpecConformance(page, text)
  })
})

describe('composeLayout — 多行（自动换行 + 强制换行 + 空行）随机对拍', () => {
  const MULTI = 160
  for (let seed = 1; seed <= MULTI; seed++) {
    it(`multi-line fuzz seed=${seed}`, () => {
      const gen = generateCase(seed, {
        maxHeight: 8,
        maxWidth: 12,
        maxGlyphs: 10,
        maxLen: 36,
      })
      // 注入约 18% 的强制换行；混入 CRLF/CR 验证换行规范化。
      const cps = Array.from(gen.text)
      let text = ''
      for (let k = 0; k < cps.length; k++) {
        if (k > 0 && ((seed * 31 + k) % 100) < 18) {
          text += seed % 3 === 0 ? '\r\n' : seed % 3 === 1 ? '\r' : '\n'
        }
        text += cps[k]
      }
      // 行宽至少容得下用到的最宽字形，保证期望成功。
      let widest = 1
      for (const g of gen.page.glyphs) widest = Math.max(widest, g.width)
      const maxWidth = widest + (seed % 13)
      expectSpecConformance(gen.page, text, maxWidth)
    })
  }
})

describe('composeLayout — 多行手工用例', () => {
  // A 宽 6、B 宽 6，页面高 4；行宽 8。
  const A6: Glyph = {
    char: 'A',
    width: 6,
    height: 4,
    rows: [
      [1, 1, 1, 1, 1, 1],
      [1, 0, 0, 0, 0, 1],
      [1, 0, 0, 0, 0, 1],
      [1, 1, 1, 1, 1, 1],
    ],
  }
  const B6: Glyph = {
    char: 'B',
    width: 6,
    height: 4,
    rows: [
      [1, 1, 1, 1, 1, 0],
      [1, 0, 0, 0, 0, 1],
      [1, 0, 0, 0, 0, 1],
      [1, 1, 1, 1, 1, 0],
    ],
  }
  const page6 = { height: 4, glyphs: [A6, B6] }

  it('ABA 行宽 8：A/B 黑像素在可容纳区间内无法共存 → 每字一行（修复前全挤在 y=0、宽 18）', () => {
    const layout = expectSpecConformance(page6, 'ABA', 8)
    // A、B 在行宽 8 内：第二个字候选从 1 起，x+6≤8 即 x≤2；
    // x=1/2 都与前字黑像素碰撞 → 无候选，各自换行。共 3 行。
    expect(layout.rowCount).toBe(3)
    expect(layout.placed.map((p) => [p.char, p.x, p.y, p.row])).toEqual([
      ['A', 0, 0, 0],
      ['B', 0, 5, 1],
      ['A', 0, 10, 2],
    ])
    expect(layout.canvasWidth).toBe(6) // 每行只有一个 6 宽字，不再是 18
    expect(layout.canvasHeight).toBe(3 * 4 + 2) // 14
  })

  it('行宽足够时多字同行：行宽 12 容纳 A+B 外框（且不碰撞），第三个折行', () => {
    const layout = expectSpecConformance(page6, 'ABA', 12)
    // B 候选 x=1..6 都与 A 碰撞；x=6 无碰撞且 6+6=12≤12 → 同行。
    // 第三个 A 与行内两字找候选：可容纳 x≤6，全部碰撞 → 折到行1。
    expect(layout.rowCount).toBe(2)
    expect(layout.placed.map((p) => [p.char, p.x, p.row])).toEqual([
      ['A', 0, 0],
      ['B', 6, 0],
      ['A', 0, 1],
    ])
    expect(layout.canvasWidth).toBe(12)
    expect(layout.canvasHeight).toBe(9)
  })

  it('宽于行宽的单个字形：单行也不产出超宽画布，而是报 glyph-too-wide', () => {
    const r = composeLayout(page6, 'A', 5)
    expect(r.ok).toBe(false)
    expect(r.error!.kind).toBe('glyph-too-wide')
    expect(r.error!.char).toBe('A')
    expect(r.error!.width).toBe(6)
    expect(r.error!.maxWidth).toBe(5)
  })

  it('强制换行、连续空行、前导/末尾空行：空行计入画布高度，换行不占序号', () => {
    const layout = expectSpecConformance(page6, '\nAB\n\nA\n', 8)
    // 视觉行：空 / A / B / 空 / A / 空 —— 共 6 行。
    expect(layout.rowCount).toBe(6)
    expect(layout.placed.map((p) => [p.index, p.char, p.x, p.row])).toEqual([
      [0, 'A', 0, 1],
      [1, 'B', 0, 2],
      [2, 'A', 0, 4],
    ])
    expect(layout.canvasHeight).toBe(6 * 4 + 5) // 29
    // 来源颜色仍按原字串的字形序号。
    expect(layout.placed.map((p) => layout.palette[p.index]).length).toBe(3)
  })

  it('换行本身不要字形：含换行的字串不再报缺失字符', () => {
    const r = composeLayout(page6, 'A\nB', 8)
    expect(r.ok).toBe(true)
    expect(r.layout!.placed.map((p) => p.char)).toEqual(['A', 'B'])
  })

  it('空行内放置的字不与上一行碰撞：跨行相同 x 的黑像素允许对齐', () => {
    // A 与 A 在相邻两行都放 x=0，y 相差 pageHeight+1=5，黑像素不重合。
    const layout = expectSpecConformance(page6, 'AA', 8)
    expect(layout.placed.map((p) => [p.x, p.y])).toEqual([
      [0, 0],
      [0, 5],
    ])
    // bbox 跨行：第二行底边在 y=8。
    expect(layout.bbox).toEqual({ minX: 0, minY: 0, maxX: 5, maxY: 8 })
  })

  it('长字串自动折行：行号/画布高度/bbox 与逐行参考一致', () => {
    const layout = expectSpecConformance(page6, 'ABABAB', 8)
    expect(layout.rowCount).toBe(6)
    expect(layout.canvasHeight).toBe(29)
    expect(layout.placed.every((p) => p.x === 0)).toBe(true)
    expect(layout.placed.map((p) => p.row)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('CRLF 与 CR 统一按一个强制换行处理（规范化后不缺字）', () => {
    const layout = expectSpecConformance(page6, 'A\r\nB\rA', 8)
    expect(layout.rowCount).toBe(3)
    expect(layout.text).toBe('A\nB\nA')
  })
})

describe('composeLayout — 长伸出笔画', () => {
  function glyph(char: string, width: number, rows: number[][]): Glyph {
    return { char, width, height: rows.length, rows }
  }

  it('第三字的顶行长臂会撞上第一字，必须越过两字整体检查', () => {
    // 高度 4。
    // A: 顶行 [0..4] 全黑，其余只有左下角一点
    const A = glyph('A', 5, [
      [1, 1, 1, 1, 1],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [1, 0, 0, 0, 0],
    ])
    // B: 仅底边黑点在最右，4 宽
    const B = glyph('B', 4, [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 1],
    ])
    // C: 顶行全黑（长臂），其它全空
    const C = glyph('C', 5, [
      [1, 1, 1, 1, 1],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
    ])
    const page = { height: 4, glyphs: [A, B, C] }
    const layout = expectSpecConformance(page, 'ABC').placed
    // A x=0；B 与 A 仅在？ A 黑点行0全部、行3列0；B 黑点行3列3。
    // B 候选 x=1：黑点全局 x=4，行3；A 行3只有 x=0 -> 不碰 -> x_B=1。
    // C 顶行：若只看相邻 B，B 行0为空，会得到 x=2；
    // 但 x=2 时 C 顶行覆盖 [2..6] 与 A 顶行 [0..4] 在 [2..4] 相撞。
    expect(layout[1].x).toBe(1)
    // x_C 必须让顶行 [x..x+4] 避开 A 的 [0..4]：x>=5；
    // 与 B（行3列3 全局4）不同行不碰，故 x_C=5。
    expect(layout[2].x).toBe(5)
  })

  it('32 宽实心 + 移位回绕守卫：dx=32 必须放行（无守卫会误判为 0 偏移而相撞）', () => {
    const rowsA = [Array.from({ length: 32 }, () => 1)]
    const rowsB = [
      Array.from({ length: 32 }, (_, c) => (c === 0 ? 1 : 0)),
    ]
    const page: GlyphPage = {
      height: 1,
      glyphs: [
        { char: 'A', width: 32, height: 1, rows: rowsA },
        { char: 'B', width: 32, height: 1, rows: rowsB },
      ],
    }
    const r = composeLayout(page, 'AB')
    expect(r.ok).toBe(true)
    // A 占满列 0..31；B 黑点在自身 c=0，候选 dx 1..31 都落在实心行上，
    // dx=32 列区间不再相交，必须放行——若漏了 dx>=32 守卫，
    // JS 的 (b<<32)==(b<<0) 会误判碰撞而选到 33。
    expect(r.layout!.placed[1].x).toBe(32)
    expect(referenceLayout(page, 'AB').placed[1].x).toBe(32)
  })
})

describe('composeLayout — 全空字形', () => {
  const empty = (ch: string, w: number, h: number): Glyph => ({
    char: ch,
    width: w,
    height: h,
    rows: Array.from({ length: h }, () =>
      Array.from({ length: w }, () => 0),
    ),
  })

  it('全空字串合成图 bbox 为 null（EMPTY），位置仍严格递增', () => {
    const page: GlyphPage = {
      height: 3,
      glyphs: [empty('a', 4, 3), empty('b', 2, 3)],
    }
    const r = composeLayout(page, 'abab')
    expect(r.ok).toBe(true)
    expect(r.layout!.bbox).toBeNull()
    expect(r.layout!.placed.map((p) => p.x)).toEqual([0, 1, 2, 3])
    expect(r.layout!.canvasWidth).toBe(6) // max x+width: 2+4=6
  })

  it('空字形可以完全覆盖在其它字空白凹口内（仅占 1 个 x 步进）', () => {
    // H=2：A 仅左上角黑，B 全空宽 3，C 仅右下角黑宽 1。
    const A: Glyph = {
      char: 'A',
      width: 3,
      height: 2,
      rows: [
        [1, 0, 0],
        [0, 0, 0],
      ],
    }
    const C: Glyph = {
      char: 'C',
      width: 1,
      height: 2,
      rows: [[0], [1]],
    }
    const page = { height: 2, glyphs: [A, empty('B', 3, 2), C] }
    const r = composeLayout(page, 'ABC')
    expect(r.layout!.placed.map((p) => p.x)).toEqual([0, 1, 2])
  })

  it('空字形后接实心字形：递增下限保证不回退，空白覆盖允许紧贴', () => {
    const page: GlyphPage = {
      height: 1,
      glyphs: [empty('a', 1, 1), { char: 'b', width: 1, height: 1, rows: [[1]] }],
    }
    const r = composeLayout(page, 'ab')
    expect(r.layout!.placed.map((p) => p.x)).toEqual([0, 1])
    expect(r.layout!.bbox).toEqual({ minX: 1, minY: 0, maxX: 1, maxY: 0 })
  })
})

describe('composeLayout — 重复字符', () => {
  const A: Glyph = {
    char: 'A',
    width: 2,
    height: 2,
    rows: [
      [1, 0],
      [0, 1],
    ],
  }

  it('重复字符每次出现都独立放置，每个实例取不同来源颜色', () => {
    // 页面只有 1 个字形时页面非法（需 2~40），加一个空字凑数。
    const Z: Glyph = {
      char: 'Z',
      width: 1,
      height: 2,
      rows: [[0], [0]],
    }
    const r = composeLayout({ height: 2, glyphs: [A, Z] }, 'AAA')
    expect(r.ok).toBe(true)
    // A 黑点 (0,0),(1,1)。
    // 实例1 x=1: 点(1,0)、(2,1) 与实例0的(0,0)(1,1) 均不重合 -> x=1
    // 实例2 x=2: 点(2,0),(3,1)；与实例0不碰，与实例1的(2,1)不碰，
    // (3,1) 无碰 -> x=2
    expect(r.layout!.placed.map((p) => p.x)).toEqual([0, 1, 2])
    const colors = r.layout!.placed.map((p) => r.layout!.palette[p.index])
    expect(new Set(colors).size).toBe(3)
  })
})

describe('composeLayout — 空白凹口紧凑伸入（核心动机）', () => {
  it('笔画伸入前字空白凹口，不按外框宽度机械留缝', () => {
    // H=3，w=3：
    const U: Glyph = {
      char: 'U',
      width: 3,
      height: 3,
      rows: [
        [1, 0, 1], // 顶部左右竖，中间凹口
        [1, 0, 1],
        [1, 1, 1], // 底部封死
      ],
    }
    // I：窄竖条，只有中间行有黑像素，可以伸进 U 的列 1 凹口。
    const I: Glyph = {
      char: 'I',
      width: 1,
      height: 3,
      rows: [[0], [1], [0]],
    }
    const page = { height: 3, glyphs: [U, I] }
    const r = composeLayout(page, 'UI')
    // 若按外框宽度，I 会放在 x=3；实际黑像素形状允许 x=1
    //（行1列1 在 U 中为空白）。
    expect(r.layout!.placed.map((p) => p.x)).toEqual([0, 1])
    // 参考实现同样结论。
    expect(referenceLayout(page, 'UI').placed.map((p) => p.x)).toEqual([0, 1])
    // 但如果 I 的黑点在底部行（U 底行全黑），就必须退到外框之外。
    const IBottom: Glyph = {
      char: 'J',
      width: 1,
      height: 3,
      rows: [[0], [0], [1]],
    }
    const page2 = { height: 3, glyphs: [U, IBottom] }
    expect(
      composeLayout(page2, 'UJ').layout!.placed.map((p) => p.x),
    ).toEqual([0, 3])
  })
})

describe('masksCollide 偏移逐像素对拍', () => {
  function naive(a: Glyph, b: Glyph, dx: number) {
    for (let r = 0; r < a.height; r++) {
      for (let ca = 0; ca < a.width; ca++) {
        if (!a.rows[r][ca]) continue
        const cb = ca - dx
        if (cb >= 0 && cb < b.width && b.rows[r][cb]) return true
      }
    }
    return false
  }

  it('随机位图对所有 dx=0..40 与逐像素判定一致（覆盖 31/32/33 回绕边界）', () => {
    for (let seed = 1; seed <= 60; seed++) {
      // 宽度取满 32 以覆盖移位回绕边界；高度与字数小一些控制成本。
      const { page } = generateCase(9000 + seed, {
        maxHeight: 4,
        minWidth: 24,
        maxWidth: 32,
        maxGlyphs: 5,
      })
      for (const ga of page.glyphs) {
        for (const gb of page.glyphs) {
          for (let dx = 0; dx <= 40; dx++) {
            const fast = masksCollide(rowMasks(ga), rowMasks(gb), dx)
            // masksCollide(a,b,dx) 语义为 b 相对 a 右移 dx；
            // naive(ga,gb,dx) 中 cb=ca-dx 同语义。
            expect(fast, `seed=${seed} dx=${dx}`).toBe(naive(ga, gb, dx))
          }
        }
      }
    }
  })
})
