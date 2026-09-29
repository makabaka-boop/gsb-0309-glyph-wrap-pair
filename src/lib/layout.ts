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
 * 二维排版规则：
 * 1. 每行首字左边缘 x=0；之后每字左边缘必须严格大于同一行前一字左边缘，
 *    从 prevX+1 开始逐个整数候选；
 * 2. 候选 x 必须不与“同一行任何已放字形”的黑像素重合（不只是相邻两字），
 *    换行后的字形不参与碰撞比较；
 * 3. 最早无碰撞候选位置放不下整幅字形外框（x + width > maxWidth）时
 *    换到下一行（下一行从 x=0 重新开始）；
 * 4. 输入中的换行符强制换行，连续换行保留空行；
 * 5. 单字外框比行宽还宽时任何位置都放不下，报 glyph-too-wide 并撤销旧排版；
 * 6. 缺失字符或页面/位图非法时返回错误，调用方据此撤销旧排版；
 * 7. 全空合成图 bbox=null（对外记为 EMPTY），但画布仍覆盖全部行与空行。
 */
export function composeLayout(page: GlyphPage, rawText: string, maxWidth = Infinity): ComposeResult {
  // \r\n 与单独的 \r 一律规范化为 \n：换行符不查字形表，
  // 连续换行保留空行，首尾换行同样占整行画布高度。
  const text = rawText.replace(/\r\n?/g, '\n')
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

  // maxWidth 为 NaN/undefined 等非法值时按不限宽处理（UI 始终夹到 8~128）。
  const lineLimit = Number.isFinite(maxWidth)
    ? Math.max(1, Math.floor(maxWidth as number))
    : Infinity

  const issues = validatePage(page)
  if (issues.length > 0) {
    return fail({
      kind: 'invalid-page',
      message: '字形页面存在非法内容，已保留编辑并撤销旧排版',
      issues,
    })
  }

  const prepared = prepare(page)
  // 换行符不是字符，不查字形表；其余码点必须都有对应字形。
  for (const ch of codePoints) {
    if (ch !== '\n' && !prepared.has(ch)) {
      return fail({
        kind: 'missing-char',
        char: ch,
        message: `缺失字符 "${ch}"：页面中没有对应字形，已保留编辑并撤销旧排版`,
      })
    }
  }

  // 单字外框比整行还宽：任何候选位置都放不下，提前报错，
  // 避免静默产出超宽画布。
  if (lineLimit !== Infinity) {
    for (const ch of codePoints) {
      const item = prepared.get(ch)
      if (item && item.glyph.width > lineLimit) {
        return fail({
          kind: 'glyph-too-wide',
          char: ch,
          message:
            `字符 "${ch}" 的字形宽 ${item.glyph.width} 超过每行最大宽度 ${lineLimit}，` +
            '无法排版：请加宽行宽或缩窄该字形，已保留编辑并撤销旧排版',
        })
      }
    }
  }

  const placed: PlacedGlyph[] = []
  let bbox: BBox | null = null
  // 当前行状态：x 从 0 重新开始；只保留同一行已放字形用于碰撞。
  let lineIndex = 0
  let prevX = -1
  let lineStartIdx = 0 // 当前行第一个已放字形在 placed 中的下标
  let placedInLine = 0

  const lineTop = () => lineIndex * (page.height + 1)

  for (let i = 0; i < codePoints.length; i++) {
    const ch = codePoints[i]

    if (ch === '\n') {
      // 强制换行：下一行从 x=0 开始，即使当前行一个字也没有（空行）。
      lineIndex++
      lineStartIdx = placed.length
      prevX = -1
      placedInLine = 0
      continue
    }

    const item = prepared.get(ch)!
    let x: number
    if (placedInLine === 0) {
      // 行首字（含自动换行后的第一个字）固定 x=0。
      x = 0
    } else {
      // 候选从 prevX+1 起，一定满足“左边缘严格大于行内前一字左边缘”。
      let candidate = prevX + 1
      for (;;) {
        let collision = false
        // 只与同一行已放字形比较：换行后的字形行号不同，永不碰撞。
        for (let j = lineStartIdx; j < placed.length; j++) {
          const other = prepared.get(placed[j].char)!
          const dx = candidate - placed[j].x
          if (masksCollide(other.masks, item.masks, dx)) {
            collision = true
            break
          }
        }
        if (!collision) {
          // 最早无碰撞候选已超出右边界：本行不可能放下，整字移到下一行。
          if (lineLimit !== Infinity && candidate + item.glyph.width > lineLimit) {
            lineIndex++
            lineStartIdx = placed.length
            prevX = -1
            placedInLine = 0
            candidate = 0
            continue
          }
          x = candidate
          break
        }
        candidate++
      }
    }

    const y = lineTop()
    placed.push({
      index: placed.length,
      char: ch,
      x,
      y,
      width: item.glyph.width,
      height: item.glyph.height,
    })
    placedInLine++

    if (item.colSpan && item.rowSpan) {
      const gMinX = x + item.colSpan.min
      const gMaxX = x + item.colSpan.max
      const gMinY = y + item.rowSpan.min
      const gMaxY = y + item.rowSpan.max
      if (bbox === null) {
        bbox = { minX: gMinX, minY: gMinY, maxX: gMaxX, maxY: gMaxY }
      } else {
        bbox.minX = Math.min(bbox.minX, gMinX)
        bbox.maxX = Math.max(bbox.maxX, gMaxX)
        bbox.minY = Math.min(bbox.minY, gMinY)
        bbox.maxY = Math.max(bbox.maxY, gMaxY)
      }
    }
    prevX = x
  }

  // 总行数 = 到达过的最大行次 + 1（自动换行与强制换行都计入，
  // 首尾/连续换行产生的空行同样占整行高度）。
  const lineCount = lineIndex + 1
  // 画布覆盖所有已放字形（含空白部分）；没有任何字形（仅换行）时宽度至少 1。
  const canvasWidth =
    placed.length === 0
      ? 1
      : Math.max(...placed.map((p) => p.x + p.width))
  // 行间保留一行空白：N 行总高 = N*H + (N-1)。
  const canvasHeight = lineCount * page.height + (lineCount - 1)

  const palette = buildPalette(placed.length)
  const layout: Layout = {
    pageHeight: page.height,
    text,
    maxWidth: lineLimit === Infinity ? Number.POSITIVE_INFINITY : lineLimit,
    placed,
    bbox,
    canvasWidth,
    canvasHeight,
    palette,
    legend: placed.map((p) => ({
      index: p.index,
      char: p.char,
      x: p.x,
      y: p.y,
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
