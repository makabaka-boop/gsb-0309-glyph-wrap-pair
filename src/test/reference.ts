import type { BBox, Glyph, GlyphPage, PlacedGlyph } from '../lib/types'

/** 确定性 32 位 PRNG（mulberry32），保证 fuzz 可复现。 */
export function makeRng(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function emptyRows(width: number, height: number): number[][] {
  return Array.from({ length: height }, () =>
    Array.from({ length: width }, () => 0),
  )
}

/** 字形全部黑像素的 (r, c) 列表，朴素循环只遍历黑像素。 */
export function blackCells(g: Glyph): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (let r = 0; r < g.height; r++) {
    for (let c = 0; c < g.width; c++) {
      if (g.rows[r][c] === 1) out.push([r, c])
    }
  }
  return out
}

/**
 * 朴素参考实现：完全按规格用“逐行占用格集合”逐黑像素模拟（二维多行）。
 * - 换行符 '\n'（调用前可先规范化 CRLF/CR）强制另起一行；
 * - 行内首字 x=0；之后候选从 prevX+1 开始逐个整数；
 * - 下一字整幅外框放进当前行会超出 maxWidth 时自动换行（行首不触发）；
 * - 每个候选的每个黑像素若落在“同一行”任一已放字形的黑像素格上即碰撞，
 *   换行后不与上一行字形比较；空白像素不进占用集合，允许互相覆盖。
 * 不做任何位运算优化，测试中快速实现（32 位行掩码）必须与此结果一致。
 *
 * maxWidth 省略/非有限时不限制行宽（仍处理强制换行）。
 */
export function referenceLayout(
  page: GlyphPage,
  text: string,
  maxWidth?: number,
) {
  const chars = Array.from(text)
  const byChar = new Map<string, Glyph>()
  const blacks = new Map<string, Array<[number, number]>>()
  for (const g of page.glyphs) {
    byChar.set(g.char, g)
    blacks.set(g.char, blackCells(g))
  }

  const placed: PlacedGlyph[] = []
  // 二维占用格集合：key = gx * KEY_XF + gy（KEY_XF 大于任何可能的 gy）。
  const KEY_XF = 100000
  const occupied = new Set<number>()
  let bbox: BBox | null = null
  const limit =
    maxWidth === undefined || !Number.isFinite(maxWidth) ? Infinity : maxWidth

  let visualRow = 0
  let prevX = -1
  let ordinal = 0
  let maxCanvasX = 0

  const collides = (ch: string, x: number, y: number) => {
    for (const [r, c] of blacks.get(ch)!) {
      if (occupied.has((x + c) * KEY_XF + (y + r))) return true
    }
    return false
  }

  const newline = () => {
    visualRow += 1
    prevX = -1
  }

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]
    if (ch === '\n') {
      newline()
      continue
    }
    const g = byChar.get(ch)!

    // 求当前行最早“无碰撞且整幅外框不超行宽”的位置；
    // 行首为 0，否则从 prevX+1 起逐个枚举，找不到可容纳候选则换行。
    let x: number
    let yy = visualRow * (page.height + 1)
    if (prevX < 0) {
      x = 0
    } else {
      x = prevX + 1
      while (x + g.width <= limit && collides(ch, x, yy)) x++
      if (x + g.width > limit) {
        newline()
        x = 0
        yy = visualRow * (page.height + 1)
      }
    }
    placed.push({
      index: ordinal,
      char: ch,
      x,
      y: yy,
      row: visualRow,
      width: g.width,
      height: g.height,
    })
    for (const [r, c] of blacks.get(ch)!) {
      const gx = x + c
      const gy = yy + r
      occupied.add(gx * KEY_XF + gy)
      if (!bbox) {
        bbox = { minX: gx, minY: gy, maxX: gx, maxY: gy }
      } else {
        if (gx < bbox.minX) bbox.minX = gx
        if (gx > bbox.maxX) bbox.maxX = gx
        if (gy < bbox.minY) bbox.minY = gy
        if (gy > bbox.maxY) bbox.maxY = gy
      }
    }
    prevX = x
    ordinal++
    maxCanvasX = Math.max(maxCanvasX, x + g.width)
  }

  const rowCount = visualRow + 1
  return {
    placed,
    bbox,
    canvasWidth: Math.max(1, maxCanvasX),
    canvasHeight: rowCount * page.height + (rowCount - 1),
    rowCount,
  }
}

/**
 * 最终占用格 → 归属字实例序号。规格要求黑像素两两不重合，
 * 因此每个格至多一个属主；若出现第二个属主即为规格违反。
 * 键含全局 y：不同视觉行的黑像素互不碰撞，不能共用只按 x 编码的键。
 */
export function ownerMap(
  page: GlyphPage,
  placed: PlacedGlyph[],
): { owners: Map<number, number>; duplicates: number } {
  const KEY_XF = 100000
  const owners = new Map<number, number>()
  const byChar = new Map(page.glyphs.map((g) => [g.char, g]))
  let duplicates = 0
  for (const p of placed) {
    const g = byChar.get(p.char)!
    for (const [r, c] of blackCells(g)) {
      const key = (p.x + c) * KEY_XF + (p.y + r)
      if (owners.has(key)) duplicates++
      owners.set(key, p.index)
    }
  }
  return { owners, duplicates }
}

export interface GeneratedPage {
  page: GlyphPage
  chars: string[]
  text: string
}

type Pattern = 'sparse' | 'solid' | 'bars' | 'notch' | 'longArm'

export interface GenOptions {
  minGlyphs?: number
  maxGlyphs?: number
  minHeight?: number
  maxHeight?: number
  minWidth?: number
  maxWidth?: number
  minLen?: number
  maxLen?: number
  emptyRate?: number
}

function makeGlyph(
  char: string,
  height: number,
  width: number,
  pattern: Pattern,
  rng: () => number,
  forceEmpty: boolean,
): Glyph {
  const rows = emptyRows(width, height)
  if (!forceEmpty) {
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        let on = false
        switch (pattern) {
          case 'sparse':
            on = rng() < 0.25
            break
          case 'solid':
            on = true
            break
          case 'bars':
            on = c % 2 === 0
            break
          case 'notch':
            // 上下边实心，中间只有首尾列——形成大凹口供相邻笔画伸入。
            on = r === 0 || r === height - 1 || c === 0 || c === width - 1
            break
          case 'longArm':
            // 顶行长伸出，中间几乎全空（长伸出笔画场景）。
            on =
              r === 0 ||
              r === height - 1 ||
              (c === 0 && (r === 1 || r === height - 2))
            break
        }
        rows[r][c] = on ? 1 : 0
      }
    }
  }
  return { char, width, height, rows }
}

/**
 * 生成一个合法字形页 + 字串。默认参数取规格上限：
 * 2~40 个同高字形（高 1~32，宽 1~32），字串 1~80 码点。
 * 约 12% 概率生成全空字形；各形态覆盖稀疏/实心/竖条/凹口/长臂。
 */
export function generateCase(seed: number, opts: GenOptions = {}): GeneratedPage {
  const {
    minGlyphs = 2,
    maxGlyphs = 40,
    minHeight = 1,
    maxHeight = 32,
    minWidth = 1,
    maxWidth = 32,
    minLen = 1,
    maxLen = 80,
    emptyRate = 0.12,
  } = opts
  const rng = makeRng(seed)
  const height = minHeight + Math.floor(rng() * (maxHeight - minHeight + 1))
  const n = minGlyphs + Math.floor(rng() * (maxGlyphs - minGlyphs + 1))
  const chars: string[] = []
  // 用 PUA 码点，保证都是单码点 BMP 字符。
  const poolStart = 0xe000
  const glyphs: Glyph[] = []
  const patterns: Pattern[] = ['sparse', 'solid', 'bars', 'notch', 'longArm']

  for (let i = 0; i < n; i++) {
    chars.push(String.fromCodePoint(poolStart + i))
    const width = minWidth + Math.floor(rng() * (maxWidth - minWidth + 1))
    const forceEmpty = rng() < emptyRate
    const pattern = patterns[Math.floor(rng() * patterns.length)]
    glyphs.push(makeGlyph(chars[i], height, width, pattern, rng, forceEmpty))
  }

  const len = minLen + Math.floor(rng() * (maxLen - minLen + 1))
  let text = ''
  for (let i = 0; i < len; i++) {
    text += chars[Math.floor(rng() * chars.length)]
  }
  return { page: { height, glyphs }, chars, text }
}
