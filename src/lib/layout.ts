import type {
  BBox,
  ComposeError,
  ComposeResult,
  Glyph,
  GlyphPage,
  Layout,
  PlacedGlyph,
} from './types'
import { rowMasks, validatePage } from './glyph'

export const MAX_TEXT_LENGTH = 80

/**
 * 两个同高（y 均为 0）字形在水平偏移 dx（b 相对 a 右移）下是否有黑像素重合。
 *
 * 字形位图按行压成 32 位整数（位 c 表示第 c 列是黑像素）。
 * 把后一字的行掩码左移 dx 后与前一字行掩码按位与：
 *   - 掩码宽度以外的位本来就是 0，统一按位与即可，空白像素不贡献位；
 *   - 但 dx >= 32 不能靠移位归零，JS 移位位数按 dx & 31 回绕，必须显式放行。
 * 必须对“任意已放字形”做检查，否则第三字可能越过第二字撞上第一字的伸出笔画。
 */
export function masksCollide(
  aRows: Uint32Array,
  bRows: Uint32Array,
  dx: number,
): boolean {
  if (dx < 0) return true // 左边缘严格递增，本不会发生；防御性处理。
  // 每个字形宽 ≤ 32：偏移 ≥ 32 时两字列区间必然不相交。
  // 不能依赖 (b << dx) 归零——JS 移位位数按 dx & 31 回绕！
  if (dx >= 32) return false;
  for (let r = 0; r < aRows.length; r++) {
    const a = aRows[r]
    const b = bRows[r]
    if (a === 0 || b === 0) continue
    // dx >= 32 时 bRows[r] 左移后全部移出，结果为 0。
    if ((a & (b << dx)) >>> 0) return true
  }
  return false
}

interface PreparedGlyph {
  glyph: Glyph
  masks: Uint32Array
  /** 该字形自身黑像素的列范围（全空时为 null）。 */
  colSpan: { min: number; max: number } | null
  /** 该字形自身黑像素的行范围（全空时为 null）。 */
  rowSpan: { min: number; max: number } | null
}

function prepare(page: GlyphPage): Map<string, PreparedGlyph> {
  const map = new Map<string, PreparedGlyph>()
  for (const glyph of page.glyphs) {
    const masks = rowMasks(glyph)
    let minC = glyph.width
    let maxC = -1
    let minR = glyph.height
    let maxR = -1
    for (let r = 0; r < glyph.height; r++) {
      for (let c = 0; c < glyph.width; c++) {
        if (glyph.rows[r][c]) {
          if (c < minC) minC = c
          if (c > maxC) maxC = c
          if (r < minR) minR = r
          if (r > maxR) maxR = r
        }
      }
    }
    const hasBlack = maxR >= 0
    map.set(glyph.char, {
      glyph,
      masks,
      colSpan: hasBlack ? { min: minC, max: maxC } : null,
      rowSpan: hasBlack ? { min: minR, max: maxR } : null,
    })
  }
  return map
}

function fail(error: ComposeError): ComposeResult {
  return { ok: false, error }
}

/**
 * 离线排版入口。
 *
 * 规则：
 * 1. 首字左边缘 x=0；之后每字左边缘必须严格大于前一字左边缘，
 *    从 prevX+1 开始逐个整数候选；
 * 2. 候选 x 必须不与“任何已放字形”的黑像素重合（不只是相邻两字）；
 * 3. 空白像素允许互相覆盖，所以只比较黑像素；
 * 4. 缺失字符或页面/位图非法时返回错误，调用方据此撤销旧排版；
 * 5. 全空合成图 bbox=null（对外记为 EMPTY）。
 */
export function composeLayout(page: GlyphPage, text: string, _maxWidth?: number): ComposeResult {
  const codePoints = Array.from(text)

  if (codePoints.length === 0) {
    return fail({ kind: 'empty-text', message: '请输入要排版的字串' })
  }
  if (codePoints.length > MAX_TEXT_LENGTH) {
    return fail({
      kind: 'text-too-long',
      message: `字串长度不能超过 ${MAX_TEXT_LENGTH}（当前 ${codePoints.length}）`,
    })
  }

  const issues = validatePage(page)
  if (issues.length > 0) {
    return fail({
      kind: 'invalid-page',
      message: '字形页面存在非法内容，已保留编辑并撤销旧排版',
      issues,
    })
  }

  const prepared = prepare(page)
  for (const ch of codePoints) {
    if (!prepared.has(ch)) {
      return fail({
        kind: 'missing-char',
        char: ch,
        message: `缺失字符 "${ch}"：页面中没有对应字形，已保留编辑并撤销旧排版`,
      })
    }
  }

  const placed: PlacedGlyph[] = []
  let bbox: BBox | null = null
  let prevX = -1

  for (let i = 0; i < codePoints.length; i++) {
    const ch = codePoints[i]
    const item = prepared.get(ch)!
    let x: number
    if (i === 0) {
      x = 0
    } else {
      // 候选从 prevX+1 起，一定满足“左边缘严格大于前一字左边缘”。
      let candidate = prevX + 1
      for (;;) {
        let collision = false
        // 与所有已放字形比较，防止隔字碰撞。
        for (let j = 0; j < placed.length; j++) {
          const other = prepared.get(placed[j].char)!
          const dx = candidate - placed[j].x
          if (masksCollide(other.masks, item.masks, dx)) {
            collision = true
            break
          }
        }
        if (!collision) {
          x = candidate
          break
        }
        candidate++
      }
    }

    placed.push({
      index: i,
      char: ch,
      x,
      y: 0,
      width: item.glyph.width,
      height: item.glyph.height,
    })

    if (item.colSpan && item.rowSpan) {
      const gMinX = x + item.colSpan.min
      const gMaxX = x + item.colSpan.max
      if (bbox === null) {
        bbox = {
          minX: gMinX,
          minY: item.rowSpan.min,
          maxX: gMaxX,
          maxY: item.rowSpan.max,
        }
      } else {
        bbox.minX = Math.min(bbox.minX, gMinX)
        bbox.maxX = Math.max(bbox.maxX, gMaxX)
        bbox.minY = Math.min(bbox.minY, item.rowSpan.min)
        bbox.maxY = Math.max(bbox.maxY, item.rowSpan.max)
      }
    }
    prevX = x
  }

  // 画布覆盖所有已放字形（含空白部分），保证导出图与布局位置一致。
  const canvasWidth = Math.max(
    1,
    ...placed.map((p) => p.x + p.width),
  )

  const palette = buildPalette(placed.length)
  const layout: Layout = {
    pageHeight: page.height,
    text,
    placed,
    bbox,
    canvasWidth,
    canvasHeight: page.height,
    palette,
    legend: placed.map((p) => ({
      index: p.index,
      char: p.char,
      x: p.x,
      color: palette[p.index],
    })),
  }
  return { ok: true, layout }
}

/**
 * 确定性调色板：在色环上均匀取色（HSL，S=75%，L=45%），
 * 重复字符每次出现颜色不同——颜色按“字形来源（出现序号）”分配。
 */
export function buildPalette(n: number): string[] {
  const colors: string[] = []
  for (let i = 0; i < n; i++) {
    const hue = n === 1 ? 0 : Math.round((360 * i) / n) % 360
    colors.push(hslToHex(hue, 75, 45))
  }
  return colors
}

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100
  const light = l / 100
  const k = (n: number) => (n + h / 30) % 12
  const a = sat * Math.min(light, 1 - light)
  const f = (n: number) => {
    const v = light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
    return Math.round(v * 255)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}
