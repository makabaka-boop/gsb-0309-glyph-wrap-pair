import { describe, expect, it } from 'vitest'
import { composeLayout, masksCollide } from '../lib/layout'
import { rowMasks } from '../lib/glyph'
import { generateCase, referenceLayout } from '../test/reference'
import type { Glyph, GlyphPage } from '../lib/types'

const KEY_YF = 64 // page.height ≤ 32，乘以 64 的全局格键无碰撞

/** 规格级断言：位置严格递增、无黑像素重合、候选极小性、bbox/画布。 */
function expectSpecConformance(page: GlyphPage, text: string) {
  const result = composeLayout(page, text)
  expect(result.ok).toBe(true)
  const layout = result.layout!
  const ref = referenceLayout(page, text)

  // 与朴素逐像素参考实现完全一致。
  expect(layout.placed.map((p) => p.x)).toEqual(
    ref.placed.map((p) => p.x),
  )
  expect(layout.bbox).toEqual(ref.bbox)
  expect(layout.canvasWidth).toBe(ref.canvasWidth)

  const byChar = new Map(page.glyphs.map((g) => [g.char, g]))
  const masksByChar = new Map(page.glyphs.map((g) => [g.char, rowMasks(g)]))
  const xs = layout.placed.map((p) => p.x)

  // 首字 x=0。
  expect(xs[0]).toBe(0)

  // 左边缘严格递增。
  for (let i = 1; i < xs.length; i++) {
    expect(xs[i]).toBeGreaterThan(xs[i - 1])
  }

  // 穷举所有已放黑像素到全局占用格：每个格至多出现一次，
  // 一次遍历即覆盖“任意两字”（含隔字碰撞），无需 O(n²) 字对。
  const occupied = new Set<number>()
  const actualBlack: Array<[number, number]> = []
  for (const p of layout.placed) {
    const g = byChar.get(p.char)!
    for (let r = 0; r < g.height; r++) {
      for (let c = 0; c < g.width; c++) {
        if (!g.rows[r][c]) continue
        const key = r + (p.x + c) * KEY_YF
        expect(
          occupied.has(key),
          `全局像素 (${p.x + c},${r}) 被两个字的黑像素同时占据`,
        ).toBe(false)
        occupied.add(key)
        actualBlack.push([p.x + c, r])
      }
    }
  }

  // 候选极小性：对每个 i>=1，区间 [prevX+1, x_i-1] 内的每个整数
  // 都必须与某个已放字形黑像素碰撞（穷举偏移），不能只看相邻字。
  for (let i = 1; i < layout.placed.length; i++) {
    const curMasks = masksByChar.get(layout.placed[i].char)!
    for (let x = xs[i - 1] + 1; x < xs[i]; x++) {
      let any = false
      for (let j = 0; j < i; j++) {
        const otherMasks = masksByChar.get(layout.placed[j].char)!
        if (masksCollide(otherMasks, curMasks, x - layout.placed[j].x)) {
          any = true
          break
        }
      }
      expect(any, `x=${x} 本应发生碰撞，否则 ${xs[i]} 不是最小候选`).toBe(true)
    }
    for (let j = 0; j < i; j++) {
      expect(
        masksCollide(
          masksByChar.get(layout.placed[j].char)!,
          curMasks,
          xs[i] - layout.placed[j].x,
        ),
      ).toBe(false)
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
