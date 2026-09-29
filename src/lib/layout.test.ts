import { describe, expect, it } from 'vitest'
import { composeLayout, masksCollide } from '../lib/layout'
import { rowMasks } from '../lib/glyph'
import { generateCase, referenceLayout } from '../test/reference'
import type { Glyph, GlyphPage, PlacedGlyph } from '../lib/types'

const KEY_XF = 4096 // gy 可达 ~2048，乘 4096 的全局格键无碰撞

/** 规格级断言：行内位置严格递增、无黑像素重合、候选极小性、bbox/画布。 */
function expectSpecConformance(
  page: GlyphPage,
  text: string,
  maxWidth: number = Infinity,
) {
  const result = composeLayout(page, text, maxWidth)
  expect(result.ok).toBe(true)
  const layout = result.layout!
  const ref = referenceLayout(page, text, maxWidth)

  // 与朴素逐像素参考实现完全一致（含 y、换行与自动换行）。
  expect(layout.placed.map((p) => [p.x, p.y])).toEqual(
    ref.placed.map((p) => [p.x, p.y]),
  )
  expect(layout.bbox).toEqual(ref.bbox)
  expect(layout.canvasWidth).toBe(ref.canvasWidth)
  expect(layout.canvasHeight).toBe(ref.canvasHeight)

  const byChar = new Map(page.glyphs.map((g) => [g.char, g]))
  const masksByChar = new Map(page.glyphs.map((g) => [g.char, rowMasks(g)]))

  // 每行首字 x=0；同一行内左边缘严格递增。
  for (let i = 0; i < layout.placed.length; i++) {
    const p = layout.placed[i]
    if (i === 0 || layout.placed[i - 1].y !== p.y) {
      expect(p.x, `第 ${i} 个字是行首，x 必须为 0`).toBe(0)
    } else {
      expect(p.x).toBeGreaterThan(layout.placed[i - 1].x)
    }
  }

  // 穷举所有已放黑像素到全局占用格：每个格至多出现一次，
  // 一次遍历即覆盖“任意两字”（含隔字碰撞、跨行误碰），无需 O(n²) 字对。
  const occupied = new Set<number>()
  const actualBlack: Array<[number, number]> = []
  for (const p of layout.placed) {
    const g = byChar.get(p.char)!
    for (let r = 0; r < g.height; r++) {
      for (let c = 0; c < g.width; c++) {
        if (!g.rows[r][c]) continue
        const gx = p.x + c
        const gy = p.y + r
        const key = gy + gx * KEY_XF
        expect(
          occupied.has(key),
          `全局像素 (${gx},${gy}) 被两个字的黑像素同时占据`,
        ).toBe(false)
        occupied.add(key)
        actualBlack.push([gx, gy])
      }
    }
  }

  // 所有字形外框必须落在行宽与画布内。
  if (Number.isFinite(maxWidth)) {
    for (const p of layout.placed) {
      expect(p.x + p.width).toBeLessThanOrEqual(maxWidth)
    }
  }

  // 自动换行极小性：每个非行首字，区间 [行内 prevX+1, x_i-1] 内的每个整数
  // 都必须与某个“同一行”已放字形黑像素碰撞，或者超出行宽（穷举偏移）。
  const lineGroups = new Map<number, PlacedGlyph[]>()
  for (const p of layout.placed) {
    const list = lineGroups.get(p.y) ?? []
    list.push(p)
    lineGroups.set(p.y, list)
  }
  for (const group of lineGroups.values()) {
    for (let i = 1; i < group.length; i++) {
      const cur = group[i]
      const curMasks = masksByChar.get(cur.char)!
      for (let x = group[i - 1].x + 1; x < cur.x; x++) {
        if (Number.isFinite(maxWidth) && x + cur.width > maxWidth) continue
        let any = false
        for (let j = 0; j < i; j++) {
          const otherMasks = masksByChar.get(group[j].char)!
          if (masksCollide(otherMasks, curMasks, x - group[j].x)) {
            any = true
            break
          }
        }
        expect(any, `x=${x} 本应发生碰撞，否则 ${cur.x} 不是最小候选`).toBe(true)
      }
      for (let j = 0; j < i; j++) {
        expect(
          masksCollide(
            masksByChar.get(group[j].char)!,
            curMasks,
            cur.x - group[j].x,
          ),
        ).toBe(false)
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

describe('composeLayout — 多行：行宽自动换行 / 手动换行 / 空行（对拍）', () => {
  /** 在随机字串中按固定步长插入换行，覆盖首/尾/连续换行。 */
  function withNewlines(base: string, step: number, lead = 0, trail = 0): string {
    const parts: string[] = ['\n'.repeat(lead)]
    for (let i = 0; i < base.length; i++) {
      parts.push(base[i])
      if ((i + 1) % step === 0 && i + 1 < base.length) parts.push('\n')
    }
    parts.push('\n'.repeat(trail))
    return parts.join('')
  }

  const MULTI = 120
  for (let seed = 1; seed <= MULTI; seed++) {
    it(`multiline fuzz seed=${seed}`, () => {
      const { page, text } = generateCase(seed, {
        maxHeight: 6,
        maxWidth: 12,
        maxGlyphs: 8,
        maxLen: 30,
      })
      // 行宽取 [maxGlyphW, maxGlyphW+14]，保证不会触发超宽错误。
      const maxGlyphW = Math.max(...page.glyphs.map((g) => g.width))
      const maxWidth = maxGlyphW + (seed % 15)
      const step = 1 + (seed % 7)
      const lead = seed % 3
      const trail = (seed >> 1) % 3
      const multi = withNewlines(text, step, lead, trail)
      expectSpecConformance(page, multi, maxWidth)
    })
  }

  it('仅换行（含连续换行）：没有字形、bbox EMPTY、空行仍占画布高度', () => {
    const { page } = generateCase(42, { maxHeight: 4, maxGlyphs: 3, maxLen: 1 })
    const r = composeLayout(page, '\n\n', 10)
    expect(r.ok).toBe(true)
    const layout = r.layout!
    expect(layout.placed).toEqual([])
    expect(layout.bbox).toBeNull()
    expect(layout.canvasWidth).toBe(1)
    // 2 个换行 → 3 行：3*H + 2 个行间空行。
    expect(layout.canvasHeight).toBe(3 * page.height + 2)
  })

  it('手动换行后碰撞只比较同一行，各行 x 都从 0 起', () => {
    const { page } = generateCase(99, { maxHeight: 3, maxWidth: 6, maxGlyphs: 4, maxLen: 1 })
    const a = page.glyphs[0].char
    const b = page.glyphs[1].char
    const layout = expectSpecConformance(page, `${a}${b}\n${a}${b}`, 100)
    expect(layout.placed.map((p) => [p.x, p.y])).toEqual([
      [0, 0],
      [layout.placed[1].x, 0],
      [0, page.height + 1],
      [layout.placed[1].x, page.height + 1],
    ])
    // 两行总高 = 2H + 1。
    expect(layout.canvasHeight).toBe(page.height * 2 + 1)
  })
})

describe('composeLayout — ABA 故障场景（宽 6 字形 + 行宽 8）', () => {
  function glyph(char: string, rows: number[][]): Glyph {
    return { char, width: rows[0].length, height: rows.length, rows }
  }
  // 两个宽 6 的字形，高 2。
  const A = glyph('A', [
    [1, 0, 0, 0, 0, 1],
    [1, 1, 1, 1, 1, 1],
  ])
  const B = glyph('B', [
    [1, 1, 1, 1, 1, 0],
    [0, 0, 0, 0, 0, 1],
  ])
  const page: GlyphPage = { height: 2, glyphs: [A, B] }

  it('每个字外框宽 6 超过行内剩余空间（行宽 8）：三字各占一行，画布不再宽 18', () => {
    const r = composeLayout(page, 'ABA', 8)
    expect(r.ok).toBe(true)
    const layout = r.layout!
    expect(layout.placed.map((p) => [p.x, p.y])).toEqual([
      [0, 0],
      [0, 3],
      [0, 6],
    ])
    expect(layout.canvasWidth).toBe(6)
    expect(layout.canvasHeight).toBe(8) // 3 行 * 2 + 2 空行
    expect(layout.placed.map((p) => p.index)).toEqual([0, 1, 2])
  })

  it('单个字形宽于行宽：报 glyph-too-wide 且不产出超宽画布', () => {
    const r = composeLayout(page, 'A', 5)
    expect(r.ok).toBe(false)
    expect(r.error!.kind).toBe('glyph-too-wide')
    expect(r.error!.char).toBe('A')
  })

  it('手动换行与连续空行不再报缺失字符，空行计入画布高度', () => {
    const r = composeLayout(page, 'A\n\nB', 8)
    expect(r.ok).toBe(true)
    const layout = r.layout!
    expect(layout.placed.map((p) => [p.char, p.x, p.y])).toEqual([
      ['A', 0, 0],
      ['B', 0, 6],
    ])
    // A、空行、B → 3 行。
    expect(layout.canvasHeight).toBe(8)
  })

  it('\\r\\n 与单独 \\r 也按换行处理', () => {
    const r = composeLayout(page, 'A\r\nB\rA', 8)
    expect(r.ok).toBe(true)
    expect(r.layout!.placed.map((p) => p.y)).toEqual([0, 3, 6])
  })

  it('长字串自动换行后，位置/bbox/画布与参考实现一致', () => {
    const layout = expectSpecConformance(page, 'ABABABAB', 8)
    // 每字一行：8 行 → 高 8*2+7 = 23。
    expect(layout.canvasHeight).toBe(23)
    expect(layout.placed.every((p) => p.x === 0)).toBe(true)
    expect(layout.bbox).toEqual({
      minX: 0,
      minY: 0,
      maxX: 5,
      maxY: 22,
    })
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
